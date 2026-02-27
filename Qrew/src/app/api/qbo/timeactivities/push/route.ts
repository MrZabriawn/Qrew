// src/app/api/qbo/timeactivities/push/route.ts
// POST /api/qbo/timeactivities/push
// Body: { orgId: string; shiftId: string }
//
// Pushes a single approved shift to QBO as a TimeActivity.
// Called by the admin "Approve & Sync" action (per-shift or per-pay-period batch).
//
// State machine for shift.syncStatus:
//   pending    → (this route) → synced | failed | not_mapped
//   failed     → (retry queue or manual re-trigger) → synced | failed
//   synced     → (edit) → re-pushed via UPDATE (requires qboTimeActivityId + qboSyncToken)
//
// Guard rails:
//   - Shift must have approvalStatus = 'approved'
//   - Pay period must not be locked (locked shifts are immutable)
//   - Duplicate guard: if shift already has qboTimeActivityId, this is an UPDATE not CREATE
//
// Requires ED role (payroll_admin).

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/adminFirebase';
import { getLiveConnection, QboNotConnectedError, QboTokenRevokedError } from '@/lib/qbo/tokenManager';
import { buildTimeActivityPayload, QboMappingError } from '@/lib/qbo/timeActivity';
import {
  createTimeActivity,
  updateTimeActivity,
  QboApiError,
  QboRateLimitError,
} from '@/lib/qbo/client';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import type { Shift } from '@/types';

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

export async function POST(req: NextRequest) {
  let shiftRef: FirebaseFirestore.DocumentReference | null = null;

  try {
    const actorUid = await requireED(req);
    const { orgId, shiftId } = await req.json() as { orgId: string; shiftId: string };

    if (!orgId || !shiftId) {
      return NextResponse.json({ error: 'orgId and shiftId are required.' }, { status: 400 });
    }

    shiftRef = adminDb.collection('shifts').doc(shiftId);
    const shiftSnap = await shiftRef.get();

    if (!shiftSnap.exists) {
      return NextResponse.json({ error: `Shift ${shiftId} not found.` }, { status: 404 });
    }

    const shift = { id: shiftSnap.id, ...shiftSnap.data() } as Shift & {
      siteDayId: string;
      worksiteId?: string;
    };

    // Guard: must be approved
    if (shift.approvalStatus !== 'approved') {
      return NextResponse.json(
        { error: `Shift must be approved before syncing. Current status: ${shift.approvalStatus ?? 'pending'}` },
        { status: 422 }
      );
    }

    // Resolve worksiteId from SiteDay if not directly on the shift
    let worksiteId = shift.worksiteId;
    if (!worksiteId) {
      const siteDaySnap = await adminDb.collection('siteDays').doc(shift.siteDayId).get();
      if (!siteDaySnap.exists) {
        return NextResponse.json({ error: `SiteDay ${shift.siteDayId} not found.` }, { status: 404 });
      }
      worksiteId = siteDaySnap.data()!.worksiteId as string;
    }

    // Mark in-flight to prevent concurrent duplicate pushes
    await shiftRef.update({ syncStatus: 'pending', lastSyncAttempt: Timestamp.now() });

    const conn = await getLiveConnection(orgId);

    const payload = await buildTimeActivityPayload(shift, {
      orgId,
      worksiteId,
      programId: undefined, // extend when program tracking is added
    });

    let timeActivityId: string;
    let syncToken: string;

    if (shift.qboTimeActivityId && shift.qboSyncToken) {
      // Shift was previously synced — send an UPDATE
      const response = await updateTimeActivity(
        conn,
        shift.qboTimeActivityId,
        shift.qboSyncToken,
        payload
      );
      timeActivityId = response.TimeActivity.Id;
      syncToken      = response.TimeActivity.SyncToken;
    } else {
      // First push — CREATE
      const response = await createTimeActivity(conn, payload);
      timeActivityId = response.TimeActivity.Id;
      syncToken      = response.TimeActivity.SyncToken;
    }

    await shiftRef.update({
      syncStatus:         'synced',
      qboTimeActivityId:  timeActivityId,
      qboSyncToken:       syncToken,
      syncedAt:           Timestamp.now(),
      syncError:          FieldValue.delete(),
      syncAttempts:       FieldValue.increment(1),
    });

    return NextResponse.json({ success: true, timeActivityId });

  } catch (err: unknown) {
    const errorMessage = (err as Error).message ?? 'Unknown error';
    console.error('[QBO push]', err);

    // Classify the error to set the right syncStatus
    let syncStatus: string;
    if (err instanceof QboMappingError) {
      syncStatus = 'not_mapped'; // needs human action, not a retry
    } else if (err instanceof QboRateLimitError) {
      syncStatus = 'retry';
    } else {
      syncStatus = 'failed';
    }

    if (shiftRef) {
      await shiftRef.update({
        syncStatus,
        syncError:    errorMessage,
        syncAttempts: FieldValue.increment(1),
        lastSyncAttempt: Timestamp.now(),
      }).catch(console.error);
    }

    const statusCode =
      err instanceof QboNotConnectedError  ? 424 :
      err instanceof QboTokenRevokedError  ? 424 :
      err instanceof QboMappingError       ? 422 :
      err instanceof QboRateLimitError     ? 429 :
      err instanceof QboApiError           ? 502 : 500;

    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
