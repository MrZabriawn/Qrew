// src/app/api/qbo/timeactivities/retry/route.ts
// POST /api/qbo/timeactivities/retry
// Body: { orgId: string; shiftIds?: string[] }
//
// Manual retry trigger for the admin dashboard.
// When shiftIds is omitted, retries ALL shifts for the org with syncStatus = 'failed' or 'retry'.
// This complements the automated Firebase Function retry queue — admins can trigger an
// immediate retry without waiting for the next scheduled run.
//
// Each shift is attempted sequentially (not parallel) to respect QBO rate limits.
// Returns a summary of successes and failures.

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/adminFirebase';
import { getLiveConnection } from '@/lib/qbo/tokenManager';
import { buildTimeActivityPayload, QboMappingError } from '@/lib/qbo/timeActivity';
import {
  createTimeActivity,
  updateTimeActivity,
  QboRateLimitError,
} from '@/lib/qbo/client';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import type { Shift } from '@/types';

const MAX_ATTEMPTS = 10; // shifts past this threshold are dead_letter

async function requireED(req: NextRequest): Promise<string> {
  const idToken = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  if (!idToken) throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  const decoded  = await adminAuth.verifyIdToken(idToken);
  const userSnap = await adminDb.collection('users').doc(decoded.uid).get();
  if (!userSnap.exists || userSnap.data()?.role !== 'ED') {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
  return decoded.uid;
}

interface RetryResult {
  shiftId: string;
  outcome: 'synced' | 'failed' | 'not_mapped' | 'dead_letter' | 'rate_limited';
  error?:  string;
}

export async function POST(req: NextRequest) {
  try {
    await requireED(req);
    const body = await req.json() as { orgId: string; shiftIds?: string[] };
    const { orgId, shiftIds } = body;

    if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

    // Build the list of shift references to retry
    let shiftRefs: FirebaseFirestore.DocumentReference[];

    if (shiftIds && shiftIds.length > 0) {
      shiftRefs = shiftIds.map((id) => adminDb.collection('shifts').doc(id));
    } else {
      const q = await adminDb
        .collection('shifts')
        .where('organizationId', '==', orgId)
        .where('syncStatus', 'in', ['failed', 'retry'])
        .where('approvalStatus', '==', 'approved')
        .limit(50) // cap per-request batch
        .get();
      shiftRefs = q.docs.map((d) => d.ref);
    }

    const conn    = await getLiveConnection(orgId);
    const results: RetryResult[] = [];

    for (const ref of shiftRefs) {
      const snap  = await ref.get();
      if (!snap.exists) continue;

      const shift = { id: snap.id, ...snap.data() } as Shift & { worksiteId?: string };

      // Dead-letter guard
      if ((shift.syncAttempts ?? 0) >= MAX_ATTEMPTS) {
        await ref.update({ syncStatus: 'dead_letter' });
        results.push({ shiftId: shift.id, outcome: 'dead_letter' });
        continue;
      }

      let worksiteId = shift.worksiteId;
      if (!worksiteId) {
        const sdSnap = await adminDb.collection('siteDays').doc(shift.siteDayId).get();
        worksiteId   = sdSnap.exists ? (sdSnap.data()!.worksiteId as string) : '';
      }

      await ref.update({ syncStatus: 'pending', lastSyncAttempt: Timestamp.now() });

      try {
        const payload = await buildTimeActivityPayload(shift, { orgId, worksiteId });

        let taId: string;
        let st: string;

        if (shift.qboTimeActivityId && shift.qboSyncToken) {
          const r = await updateTimeActivity(conn, shift.qboTimeActivityId, shift.qboSyncToken, payload);
          taId = r.TimeActivity.Id;
          st   = r.TimeActivity.SyncToken;
        } else {
          const r = await createTimeActivity(conn, payload);
          taId = r.TimeActivity.Id;
          st   = r.TimeActivity.SyncToken;
        }

        await ref.update({
          syncStatus:        'synced',
          qboTimeActivityId: taId,
          qboSyncToken:      st,
          syncedAt:          Timestamp.now(),
          syncError:         FieldValue.delete(),
          syncAttempts:      FieldValue.increment(1),
        });
        results.push({ shiftId: shift.id, outcome: 'synced' });

      } catch (err: unknown) {
        const msg = (err as Error).message ?? 'unknown';
        const nextStatus = err instanceof QboMappingError
          ? 'not_mapped'
          : err instanceof QboRateLimitError
            ? 'retry'
            : 'failed';

        await ref.update({
          syncStatus:   nextStatus,
          syncError:    msg,
          syncAttempts: FieldValue.increment(1),
        });

        results.push({
          shiftId: shift.id,
          outcome: nextStatus === 'not_mapped'
            ? 'not_mapped'
            : nextStatus === 'retry'
              ? 'rate_limited'
              : 'failed',
          error: msg,
        });

        // Stop processing if we hit a rate limit
        if (err instanceof QboRateLimitError) break;
      }
    }

    const summary = {
      total:       results.length,
      synced:      results.filter((r) => r.outcome === 'synced').length,
      failed:      results.filter((r) => r.outcome === 'failed').length,
      not_mapped:  results.filter((r) => r.outcome === 'not_mapped').length,
      dead_letter: results.filter((r) => r.outcome === 'dead_letter').length,
      rate_limited: results.filter((r) => r.outcome === 'rate_limited').length,
    };

    return NextResponse.json({ summary, results });

  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    console.error('[QBO retry]', err);
    return NextResponse.json(
      { error: e.message ?? 'Internal server error' },
      { status: e.status ?? 500 }
    );
  }
}
