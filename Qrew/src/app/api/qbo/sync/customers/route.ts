// src/app/api/qbo/sync/customers/route.ts
// POST /api/qbo/sync/customers
// Body: { orgId: string }
//
// Pulls the Customer (Job) list from QBO and caches it for the worksite-mapping UI.
// Customers in QBO represent job sites / projects — they link to the CustomerRef on
// each TimeActivity, enabling job costing reports in QBO.

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/adminFirebase';
import { getLiveConnection } from '@/lib/qbo/tokenManager';
import { listCustomers } from '@/lib/qbo/client';
import { Timestamp } from 'firebase-admin/firestore';

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
    const customers = await listCustomers(conn);

    const cacheRef = adminDb
      .collection('organizations').doc(orgId)
      .collection('qboCustomerCache');

    const BATCH_SIZE = 400;
    for (let i = 0; i < customers.length; i += BATCH_SIZE) {
      const batch = adminDb.batch();
      for (const c of customers.slice(i, i + BATCH_SIZE)) {
        batch.set(cacheRef.doc(c.id), { ...c, cachedAt: Timestamp.now() });
      }
      await batch.commit();
    }

    return NextResponse.json({ synced: customers.length, customers });

  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    console.error('[QBO sync/customers]', err);
    return NextResponse.json(
      { error: e.message ?? 'Internal server error' },
      { status: e.status ?? 500 }
    );
  }
}
