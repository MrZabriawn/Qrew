// functions/src/qboRetryQueue.ts
// Scheduled Firebase Function: runs every 15 minutes.
//
// Scans the shifts collection for records with:
//   syncStatus IN ('failed', 'retry')
//   approvalStatus = 'approved'
//   syncAttempts < MAX_ATTEMPTS
//   lastSyncAttempt < (now - backoff_delay)
//
// Exponential backoff (capped at 30 min):
//   attempt 1 → 2 min   attempt 2 → 4 min   attempt 3 → 8 min
//   attempt 4 → 16 min  attempt 5+ → 30 min
//
// On success: sets syncStatus='synced', stores qboTimeActivityId + qboSyncToken.
// On 10th failure: sets syncStatus='dead_letter' (requires manual admin intervention).
//
// This function uses the same QBO client logic as the API routes but runs as a
// background job decoupled from any HTTP request. It reads QBO credentials from
// Firestore (tokenManager) using the Admin SDK.
//
// NOTE: This function requires QBO_ENCRYPTION_KEY and QBO_CLIENT_ID/SECRET to be
// set in functions/.env (not .env.local). Use:
//   firebase functions:config:set qbo.encryption_key="..." (for older Functions SDK)
// OR for Functions v2, set them in functions/.env directly.

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Admin is already initialized in functions/src/index.ts — do not re-initialize.

const MAX_ATTEMPTS = 10;
const QBO_BASE: Record<string, string> = {
  sandbox:    'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
};

// ─── Encryption (duplicated from src/lib/qbo/encryption.ts for functions isolation) ───
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const key = process.env.QBO_ENCRYPTION_KEY;
  if (!key || key.length !== 64) throw new Error('QBO_ENCRYPTION_KEY missing or invalid in functions env.');
  return Buffer.from(key, 'hex');
}

function decrypt(ciphertext: string): string {
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  const iv  = Buffer.from(ivHex,  'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const enc = Buffer.from(dataHex, 'hex');
  const dec = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
}

function encrypt(plaintext: string): string {
  const iv     = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

// ─── Backoff helper ──────────────────────────────────────────────────────────

function backoffMinutes(attempts: number): number {
  return Math.min(30, Math.pow(2, attempts));
}

// ─── Token management (inline, no external imports) ─────────────────────────

interface QboConn { realmId: string; accessToken: string; env: 'sandbox' | 'production' }

async function getLiveToken(orgId: string): Promise<QboConn> {
  const snap = await admin.firestore()
    .collection('organizations').doc(orgId)
    .collection('qboConnection').doc('current')
    .get();

  if (!snap.exists) throw new Error(`No QBO connection for org ${orgId}`);

  const data     = snap.data()!;
  const expiry   = (data.tokenExpiry as admin.firestore.Timestamp).toDate();
  const msLeft   = expiry.getTime() - Date.now();
  let   at: string;

  if (msLeft > 5 * 60 * 1000) {
    at = decrypt(data.encryptedAccessToken as string);
  } else {
    const rt  = decrypt(data.encryptedRefreshToken as string);
    const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        Authorization:  `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept:         'application/json',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt }),
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const tokens: { access_token: string; refresh_token: string; expires_in: number } = await res.json();
    await snap.ref.update({
      encryptedAccessToken:  encrypt(tokens.access_token),
      encryptedRefreshToken: encrypt(tokens.refresh_token),
      tokenExpiry: admin.firestore.Timestamp.fromDate(new Date(Date.now() + tokens.expires_in * 1000)),
    });
    at = tokens.access_token;
  }

  return { realmId: data.realmId as string, accessToken: at, env: data.qboEnvironment as 'sandbox' | 'production' };
}

// ─── QBO TimeActivity push (inline) ─────────────────────────────────────────

async function pushToQbo(
  conn: QboConn,
  shiftId: string,
  shiftData: FirebaseFirestore.DocumentData,
  worksiteId: string,
  orgId: string
): Promise<{ id: string; syncToken: string }> {
  // Resolve employee mapping
  const empSnap = await admin.firestore()
    .collection('organizations').doc(orgId)
    .collection('qboEmployeeMappings').doc(shiftData.userId)
    .get();

  if (!empSnap.exists) throw new Error(`User ${shiftData.userId} has no QBO mapping.`);

  const emp      = empSnap.data()!;
  const entityId = emp.qboEntityId as string;
  const entityType = emp.qboEntityType as 'Employee' | 'Vendor';
  const entityName = emp.qboDisplayName as string;

  // Resolve customer mapping (optional)
  const custSnap = await admin.firestore()
    .collection('organizations').doc(orgId)
    .collection('qboCustomerMappings').doc(worksiteId)
    .get();

  const inAt  = (shiftData.inAt  as admin.firestore.Timestamp).toDate();
  const outAt = (shiftData.outAt as admin.firestore.Timestamp).toDate();
  const totalMin = Math.round((outAt.getTime() - inAt.getTime()) / 60_000);

  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => {
    const offset = -d.getTimezoneOffset();
    const sign   = offset >= 0 ? '+' : '-';
    const hh     = pad(Math.floor(Math.abs(offset) / 60));
    const mm     = pad(Math.abs(offset) % 60);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm}`;
  };

  const body: Record<string, unknown> = {
    TxnDate:        `${inAt.getFullYear()}-${pad(inAt.getMonth() + 1)}-${pad(inAt.getDate())}`,
    NameOf:         entityType,
    BillableStatus: 'NotBillable',
    Taxable:        false,
    StartTime:      fmt(inAt),
    EndTime:        fmt(outAt),
    Hours:          Math.floor(totalMin / 60),
    Minutes:        totalMin % 60,
    Description:    `Qrew shift ${shiftId}`,
  };

  if (entityType === 'Employee') body.EmployeeRef = { value: entityId, name: entityName };
  else                           body.VendorRef   = { value: entityId, name: entityName };

  if (custSnap.exists) {
    body.CustomerRef = { value: custSnap.data()!.qboCustomerId, name: custSnap.data()!.qboDisplayName };
  }

  // If previously synced, send an UPDATE
  if (shiftData.qboTimeActivityId) {
    body.Id        = shiftData.qboTimeActivityId;
    body.SyncToken = shiftData.qboSyncToken;
    body.sparse    = false;
  }

  const url = `${QBO_BASE[conn.env]}/v3/company/${conn.realmId}/timeactivity`;
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${conn.accessToken}`,
      'Content-Type': 'application/json',
      Accept:         'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) throw new Error('RATE_LIMIT');
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`QBO API ${res.status}: ${errBody}`);
  }

  const data: { TimeActivity: { Id: string; SyncToken: string } } = await res.json();
  return { id: data.TimeActivity.Id, syncToken: data.TimeActivity.SyncToken };
}

// ─── Exported Cloud Function ─────────────────────────────────────────────────

export const qboRetryQueue = functions.pubsub
  .schedule('every 15 minutes')
  .onRun(async () => {
    const orgId = process.env.QBO_ORG_ID;
    if (!orgId) {
      console.warn('[qboRetryQueue] QBO_ORG_ID not set — skipping.');
      return null;
    }

    const now        = admin.firestore.Timestamp.now();
    const shiftsRef  = admin.firestore().collection('shifts');

    // Query shifts that are eligible for retry
    const snapshot = await shiftsRef
      .where('organizationId', '==', orgId)
      .where('approvalStatus', '==', 'approved')
      .where('syncStatus', 'in', ['failed', 'retry'])
      .limit(20) // process 20 per run to stay within execution limits
      .get();

    if (snapshot.empty) return null;

    let conn: QboConn;
    try {
      conn = await getLiveToken(orgId);
    } catch (err) {
      console.error('[qboRetryQueue] Cannot get live token:', err);
      return null;
    }

    for (const doc of snapshot.docs) {
      const data     = doc.data();
      const attempts = (data.syncAttempts as number) ?? 0;

      // Check backoff: skip if not enough time has passed since last attempt
      if (data.lastSyncAttempt) {
        const lastAttempt = (data.lastSyncAttempt as admin.firestore.Timestamp).toDate();
        const backoffMs   = backoffMinutes(attempts) * 60_000;
        if (Date.now() - lastAttempt.getTime() < backoffMs) {
          continue; // not ready yet
        }
      }

      // Dead-letter after MAX_ATTEMPTS
      if (attempts >= MAX_ATTEMPTS) {
        await doc.ref.update({ syncStatus: 'dead_letter' });
        console.warn(`[qboRetryQueue] Shift ${doc.id} marked dead_letter after ${attempts} attempts.`);
        continue;
      }

      // Resolve worksiteId from SiteDay
      let worksiteId = data.worksiteId as string | undefined;
      if (!worksiteId) {
        const sdSnap = await admin.firestore().collection('siteDays').doc(data.siteDayId).get();
        worksiteId   = sdSnap.exists ? (sdSnap.data()!.worksiteId as string) : '';
      }

      await doc.ref.update({
        syncStatus:       'pending',
        lastSyncAttempt: now,
        syncAttempts:    admin.firestore.FieldValue.increment(1),
      });

      try {
        const result = await pushToQbo(conn, doc.id, data, worksiteId, orgId);

        await doc.ref.update({
          syncStatus:        'synced',
          qboTimeActivityId: result.id,
          qboSyncToken:      result.syncToken,
          syncedAt:          admin.firestore.Timestamp.now(),
          syncError:         admin.firestore.FieldValue.delete(),
        });

        console.log(`[qboRetryQueue] Shift ${doc.id} synced → TimeActivity ${result.id}`);

      } catch (err: unknown) {
        const msg = (err as Error).message ?? 'unknown';
        const nextStatus = msg === 'RATE_LIMIT' ? 'retry' : 'failed';

        await doc.ref.update({ syncStatus: nextStatus, syncError: msg });
        console.error(`[qboRetryQueue] Shift ${doc.id} failed (attempt ${attempts + 1}): ${msg}`);

        if (msg === 'RATE_LIMIT') break; // stop processing on rate limit
      }
    }

    return null;
  });
