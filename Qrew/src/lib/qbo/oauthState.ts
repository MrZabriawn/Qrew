// src/lib/qbo/oauthState.ts
// Stateless CSRF-safe OAuth state parameter.
//
// Intuit's OAuth 2.0 flow requires a `state` parameter. We sign it with HMAC-SHA256
// using QBO_OAUTH_STATE_SECRET so:
//   1. We never need a server-side session or Firestore write to store the nonce.
//   2. The callback verifier can confirm the state came from us and contains a valid orgId.
//   3. A tampering attempt (changing the orgId or nonce) will fail signature verification.
//
// State format (before base64url encoding):
//   <orgId>|<issuedAt_ms>|<random_hex_16>
// Encoded value stored in `state` query parameter:
//   base64url(<payload>).<hmac_sha256_hex_first_32_chars>

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const STATE_MAX_AGE_MS = 15 * 60 * 1000; // states older than 15 min are rejected

function getSecret(): string {
  const s = process.env.QBO_OAUTH_STATE_SECRET;
  if (!s || s.length < 32) {
    throw new Error('QBO_OAUTH_STATE_SECRET must be at least 32 characters.');
  }
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex')
    .slice(0, 32); // truncate to 32 hex chars for URL cleanliness
}

/** Creates a signed, self-contained state token embedding the orgId. */
export function createState(orgId: string): string {
  const nonce   = randomBytes(8).toString('hex');
  const payload = `${orgId}|${Date.now()}|${nonce}`;
  const sig     = sign(payload);
  const encoded = Buffer.from(payload).toString('base64url');
  return `${encoded}.${sig}`;
}

export interface VerifiedState {
  orgId: string;
}

/**
 * Verifies a state token returned in the OAuth callback.
 * Throws if invalid, expired, or tampered.
 */
export function verifyState(state: string): VerifiedState {
  const dotIdx = state.lastIndexOf('.');
  if (dotIdx === -1) throw new Error('Malformed OAuth state: missing signature separator.');

  const encoded = state.slice(0, dotIdx);
  const sig     = state.slice(dotIdx + 1);
  const payload = Buffer.from(encoded, 'base64url').toString('utf8');

  const expectedSig = sign(payload);
  // Constant-time comparison prevents timing attacks
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    throw new Error('OAuth state signature verification failed.');
  }

  const [orgId, issuedAtStr] = payload.split('|');
  const issuedAt = parseInt(issuedAtStr, 10);

  if (Date.now() - issuedAt > STATE_MAX_AGE_MS) {
    throw new Error('OAuth state has expired. Please restart the connection flow.');
  }

  return { orgId };
}
