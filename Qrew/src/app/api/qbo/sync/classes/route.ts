// src/app/api/qbo/sync/classes/route.ts
// POST /api/qbo/sync/classes
// Body: { orgId: string }
//
// Pulls the Class list from QBO and caches it for the program-mapping UI.
// QBO Classes segment income/expense by department or program — useful for
// housing organizations that run multiple funded programs simultaneously.

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/adminFirebase';
import { getLiveConnection } from '@/lib/qbo/tokenManager';
import { listClasses } from '@/lib/qbo/client';
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

    const conn    = await getLiveConnection(orgId);
    const classes = await listClasses(conn);

    const cacheRef = adminDb
      .collection('organizations').doc(orgId)
      .collection('qboClassCache');

    const BATCH_SIZE = 400;
    for (let i = 0; i < classes.length; i += BATCH_SIZE) {
      const batch = adminDb.batch();
      for (const c of classes.slice(i, i + BATCH_SIZE)) {
        batch.set(cacheRef.doc(c.id), { ...c, cachedAt: Timestamp.now() });
      }
      await batch.commit();
    }

    return NextResponse.json({ synced: classes.length, classes });

  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    console.error('[QBO sync/classes]', err);
    return NextResponse.json(
      { error: e.message ?? 'Internal server error' },
      { status: e.status ?? 500 }
    );
  }
}
