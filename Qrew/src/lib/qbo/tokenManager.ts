// src/lib/qbo/tokenManager.ts
// Server-side store for QBO OAuth tokens.
//
// Responsibilities:
//   - Read the encrypted QBO connection document from Firestore
//   - Decrypt tokens on read; encrypt on write
//   - Automatically refresh the access token when it expires or is within 5 minutes of expiry
//   - Update the stored tokens after a successful refresh
//   - Throw typed errors for disconnected, revoked, or missing connections
//
// Firestore path: organizations/{orgId}/qboConnection/current
//
// This module is server-side only. Import only from API routes or Firebase Functions.

import { adminDb } from '@/lib/adminFirebase';
import { encrypt, decrypt } from './encryption';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // refresh if < 5 min remaining

export interface LiveConnection {
  realmId: string;
  accessToken: string;     // plaintext — valid for the next 5+ minutes
  qboEnvironment: 'sandbox' | 'production';
}

export class QboNotConnectedError extends Error {
  constructor(orgId: string) {
    super(`Organization ${orgId} has no active QBO connection.`);
    this.name = 'QboNotConnectedError';
  }
}

export class QboTokenRevokedError extends Error {
  constructor() {
    super('QBO connection has been revoked. The organization must reconnect via OAuth.');
    this.name = 'QboTokenRevokedError';
  }
}

/**
 * Returns a live, valid access token for the given org.
 * Automatically refreshes if the stored token expires within REFRESH_THRESHOLD_MS.
 * Throws QboNotConnectedError or QboTokenRevokedError on bad state.
 */
export async function getLiveConnection(orgId: string): Promise<LiveConnection> {
  const connRef = adminDb
    .collection('organizations').doc(orgId)
    .collection('qboConnection').doc('current');

  const snap = await connRef.get();
  if (!snap.exists) throw new QboNotConnectedError(orgId);

  const data = snap.data()!;

  if (data.status === 'revoked' || data.status === 'disconnected') {
    throw new QboTokenRevokedError();
  }

  const tokenExpiry: Date = (data.tokenExpiry as Timestamp).toDate();
  const now = new Date();
  const msUntilExpiry = tokenExpiry.getTime() - now.getTime();

  let accessToken: string;

  if (msUntilExpiry > REFRESH_THRESHOLD_MS) {
    // Token is still fresh — just decrypt and return it
    accessToken = decrypt(data.encryptedAccessToken as string);
  } else {
    // Token is expired or about to expire — refresh it
    const refreshToken = decrypt(data.encryptedRefreshToken as string);
    const refreshed = await refreshAccessToken(refreshToken);

    // Persist the new tokens immediately so concurrent calls benefit
    await connRef.update({
      encryptedAccessToken:  encrypt(refreshed.access_token),
      encryptedRefreshToken: encrypt(refreshed.refresh_token),
      tokenExpiry: Timestamp.fromDate(
        new Date(now.getTime() + refreshed.expires_in * 1000)
      ),
      status: 'active',
    });

    accessToken = refreshed.access_token;
  }

  return {
    realmId: data.realmId as string,
    accessToken,
    qboEnvironment: data.qboEnvironment as 'sandbox' | 'production',
  };
}

/**
 * Persists a new QBO connection after a successful OAuth callback.
 * Creates or fully overwrites the connection document.
 */
export async function saveConnection(
  orgId: string,
  params: {
    realmId: string;
    accessToken: string;
    refreshToken: string;
    expiresInSeconds: number;
    connectedByUserId: string;
    qboEnvironment: 'sandbox' | 'production';
  }
): Promise<void> {
  const connRef = adminDb
    .collection('organizations').doc(orgId)
    .collection('qboConnection').doc('current');

  await connRef.set({
    realmId:                params.realmId,
    encryptedAccessToken:  encrypt(params.accessToken),
    encryptedRefreshToken: encrypt(params.refreshToken),
    tokenExpiry: Timestamp.fromDate(
      new Date(Date.now() + params.expiresInSeconds * 1000)
    ),
    connectedAt: FieldValue.serverTimestamp(),
    connectedByUserId: params.connectedByUserId,
    status: 'active',
    qboEnvironment: params.qboEnvironment,
  });
}

/**
 * Marks the connection as disconnected without deleting it (preserves audit trail).
 */
export async function revokeConnection(orgId: string): Promise<void> {
  const connRef = adminDb
    .collection('organizations').doc(orgId)
    .collection('qboConnection').doc('current');

  await connRef.update({ status: 'disconnected' });
}

// ─── Internal helpers ────────────────────────────────────────────────────────

interface IntuitTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;   // seconds until access_token expiry (typically 3600)
  token_type: string;
}

async function refreshAccessToken(refreshToken: string): Promise<IntuitTokenResponse> {
  const clientId     = process.env.QBO_CLIENT_ID!;
  const clientSecret = process.env.QBO_CLIENT_SECRET!;
  const credentials  = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
      'Accept':        'application/json',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // Intuit returns 400 when the refresh token is revoked or expired
    if (res.status === 400 || res.status === 401) {
      throw new QboTokenRevokedError();
    }
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<IntuitTokenResponse>;
}
