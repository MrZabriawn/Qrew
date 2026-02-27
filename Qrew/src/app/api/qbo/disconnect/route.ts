// src/app/api/qbo/disconnect/route.ts
// POST /api/qbo/disconnect
// Body: { orgId: string }
//
// Revokes the QBO connection for an organization.
// Also revokes the tokens at Intuit's endpoint so they cannot be reused.
// Only the ED role may call this endpoint.

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/adminFirebase';
import { decrypt } from '@/lib/qbo/encryption';
import { revokeConnection } from '@/lib/qbo/tokenManager';
import { Timestamp } from 'firebase-admin/firestore';

const INTUIT_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

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
    const actorUid = await requireED(req);
    const { orgId } = await req.json() as { orgId: string };

    if (!orgId) {
      return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });
    }

    // Read the current connection to get the refresh token for remote revocation
    const connSnap = await adminDb
      .collection('organizations').doc(orgId)
      .collection('qboConnection').doc('current')
      .get();

    if (connSnap.exists) {
      const data = connSnap.data()!;
      // Best-effort remote revocation — don't fail the disconnect if Intuit is down
      try {
        const refreshToken = decrypt(data.encryptedRefreshToken as string);
        const clientId     = process.env.QBO_CLIENT_ID!;
        const clientSecret = process.env.QBO_CLIENT_SECRET!;
        const credentials  = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

        await fetch(INTUIT_REVOKE_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type':  'application/json',
            'Accept':        'application/json',
          },
          body: JSON.stringify({ token: refreshToken }),
        });
      } catch (revokeErr) {
        console.warn('[QBO disconnect] Remote revocation failed (non-fatal):', revokeErr);
      }
    }

    // Mark as disconnected in Firestore
    await revokeConnection(orgId);

    // Audit log
    await adminDb.collection('auditLogs').add({
      actorUserId: actorUid,
      actionType:  'QBO_DISCONNECTED',
      entityType:  'QBO_CONNECTION',
      entityId:    orgId,
      createdAt:   Timestamp.now(),
    });

    return NextResponse.json({ success: true });

  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    return NextResponse.json(
      { error: e.message ?? 'Internal server error' },
      { status: e.status ?? 500 }
    );
  }
}
