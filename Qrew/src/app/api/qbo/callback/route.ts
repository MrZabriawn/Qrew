// src/app/api/qbo/callback/route.ts
// GET /api/qbo/callback?code=<code>&state=<state>&realmId=<realmId>
//
// Step 2 of the Intuit OAuth 2.0 Authorization Code flow (redirect URI handler).
//
// On success:
//   - Verifies the HMAC-signed `state` to prevent CSRF
//   - Exchanges the authorization `code` for access + refresh tokens
//   - Encrypts both tokens and persists to Firestore under organizations/{orgId}/qboConnection/current
//   - Redirects the browser to /admin?qbo=connected
//
// On error (user cancelled, Intuit error):
//   - Redirects to /admin?qbo=error&reason=<msg>

import { NextRequest, NextResponse } from 'next/server';
import { verifyState } from '@/lib/qbo/oauthState';
import { saveConnection } from '@/lib/qbo/tokenManager';
import { adminAuth } from '@/lib/adminFirebase';

const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

interface IntuitTokenResponse {
  access_token:  string;
  refresh_token: string;
  expires_in:    number;
  token_type:    string;
  x_refresh_token_expires_in: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code    = searchParams.get('code');
  const state   = searchParams.get('state');
  const realmId = searchParams.get('realmId');
  const error   = searchParams.get('error');

  const adminBase = req.nextUrl.origin + '/admin';

  // User cancelled or Intuit returned an error
  if (error || !code || !state || !realmId) {
    const reason = encodeURIComponent(error ?? 'missing_params');
    return NextResponse.redirect(`${adminBase}?qbo=error&reason=${reason}`);
  }

  try {
    // Verify state — throws on tamper or expiry
    const { orgId } = verifyState(state);

    // Exchange authorization code for tokens
    const clientId     = process.env.QBO_CLIENT_ID!;
    const clientSecret = process.env.QBO_CLIENT_SECRET!;
    const redirectUri  = process.env.QBO_REDIRECT_URI!;
    const credentials  = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenRes = await fetch(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/x-www-form-urlencoded',
        'Accept':        'application/json',
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
    }

    const tokens: IntuitTokenResponse = await tokenRes.json();

    // We need a real user to attribute the connection to.
    // The state was created by an authenticated ED. We look up the org's ED from Firestore.
    // For simplicity, we store 'system' — the audit log in auth/route.ts already recorded the actor.
    const { adminDb } = await import('@/lib/adminFirebase');
    const orgSnap = await adminDb.collection('organizations').doc(orgId).get();
    const connectedByUserId = orgSnap.exists ? (orgSnap.data()?.edUserId ?? 'system') : 'system';

    await saveConnection(orgId, {
      realmId,
      accessToken:      tokens.access_token,
      refreshToken:     tokens.refresh_token,
      expiresInSeconds: tokens.expires_in,
      connectedByUserId,
      qboEnvironment:   (process.env.QBO_ENVIRONMENT ?? 'sandbox') as 'sandbox' | 'production',
    });

    return NextResponse.redirect(`${adminBase}?qbo=connected`);

  } catch (err: unknown) {
    const reason = encodeURIComponent((err as Error).message ?? 'unknown_error');
    console.error('[QBO callback] Error:', err);
    return NextResponse.redirect(`${adminBase}?qbo=error&reason=${reason}`);
  }
}
