// src/app/api/qbo/sync/employees/route.ts
// POST /api/qbo/sync/employees
// Body: { orgId: string }
//
// Pulls the full Employee + Vendor (1099) lists from QBO and caches them in Firestore
// under organizations/{orgId}/qboEmployeeCache/{id} for use in the mapping UI.
//
// Cached documents are NOT the mapping — they are the source-of-truth roster from QBO.
// Actual user→employee assignments live in qboEmployeeMappings/{userId}.
//
// Requires ED role. Only call this when the admin opens the mapping UI or when the
// QBO employee roster changes. Do not call on every shift push.

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/adminFirebase';
import { getLiveConnection } from '@/lib/qbo/tokenManager';
import { listEmployees, listVendors } from '@/lib/qbo/client';
import { Timestamp, WriteBatch } from 'firebase-admin/firestore';

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
  try {
    await requireED(req);
    const { orgId } = await req.json() as { orgId: string };
    if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

    const conn      = await getLiveConnection(orgId);
    const employees = await listEmployees(conn);
    const vendors   = await listVendors(conn);
    const all       = [...employees, ...vendors];

    // Batch-write to Firestore (max 500 per batch)
    const cacheRef = adminDb
      .collection('organizations').doc(orgId)
      .collection('qboEmployeeCache');

    const BATCH_SIZE = 400;
    for (let i = 0; i < all.length; i += BATCH_SIZE) {
      const batch: WriteBatch = adminDb.batch();
      for (const entity of all.slice(i, i + BATCH_SIZE)) {
        batch.set(cacheRef.doc(entity.id), {
          ...entity,
          cachedAt: Timestamp.now(),
        });
      }
      await batch.commit();
    }

    return NextResponse.json({ synced: all.length, employees: all });

  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    console.error('[QBO sync/employees]', err);
    return NextResponse.json(
      { error: e.message ?? 'Internal server error' },
      { status: e.status ?? 500 }
    );
  }
}
