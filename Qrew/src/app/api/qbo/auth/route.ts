// src/app/api/qbo/auth/route.ts
// GET /api/qbo/auth?orgId=<orgId>
//
// Step 1 of the Intuit OAuth 2.0 Authorization Code flow.
// Validates that the caller is an authenticated ED for the given org, then
// constructs and redirects to the Intuit authorization URL.
//
// Required scopes: com.intuit.quickbooks.accounting
// The `state` parameter is HMAC-signed — see oauthState.ts.

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/adminFirebase';
import { createState } from '@/lib/qbo/oauthState';

const INTUIT_AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2';

// Validate the caller's Firebase ID token and return their UID + role.
async function requireED(req: NextRequest): Promise<string> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const idToken    = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!idToken) {
    throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  }

  const decoded = await adminAuth.verifyIdToken(idToken);

  // Fetch the user's role from Firestore via the admin SDK
  const { adminDb } = await import('@/lib/adminFirebase');
  const userSnap = await adminDb.collection('users').doc(decoded.uid).get();

  if (!userSnap.exists || userSnap.data()?.role !== 'ED') {
    throw Object.assign(new Error('Forbidden: only ED role may manage QBO connections.'), { status: 403 });
  }

  return decoded.uid;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId');

    if (!orgId) {
      return NextResponse.json({ error: 'orgId query parameter is required.' }, { status: 400 });
    }

    await requireED(req);

    const state       = createState(orgId);
    const clientId    = process.env.QBO_CLIENT_ID;
    const redirectUri = process.env.QBO_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return NextResponse.json(
        { error: 'QBO_CLIENT_ID and QBO_REDIRECT_URI must be set in environment.' },
        { status: 500 }
      );
    }

    const params = new URLSearchParams({
      client_id:     clientId,
      scope:         'com.intuit.quickbooks.accounting',
      redirect_uri:  redirectUri,
      response_type: 'code',
      state,
    });

    const authUrl = `${INTUIT_AUTH_BASE}?${params.toString()}`;

    // When the caller sends X-Return-Url: 1 (e.g., client-side fetch with auth header),
    // return the URL as JSON instead of redirecting — the browser can't send custom headers
    // during a navigation, so the client fetches the URL first, then navigates to it.
    if (req.headers.get('x-return-url') === '1') {
      return NextResponse.json({ url: authUrl });
    }

    return NextResponse.redirect(authUrl);

  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    return NextResponse.json(
      { error: e.message ?? 'Internal server error' },
      { status: e.status ?? 500 }
    );
  }
}
