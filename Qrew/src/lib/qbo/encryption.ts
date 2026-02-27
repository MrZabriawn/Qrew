// src/lib/qbo/encryption.ts
// AES-256-GCM symmetric encryption for QBO OAuth tokens stored in Firestore.
//
// WHY GCM: Authenticated encryption — the auth tag detects any bit-level tampering
// of the ciphertext in Firestore before we ever try to use a token.
//
// KEY FORMAT: 64 hex characters (32 raw bytes). Generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Ciphertext format stored in Firestore: "<iv_hex>:<tag_hex>:<ciphertext_hex>"
// Each component is colon-delimited so we can parse without a fixed byte offset.
//
// This module is server-side only (Node.js crypto). Never import it from client components.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES  = 16; // 128-bit IV — randomised per encryption call

function getKey(): Buffer {
  const hexKey = process.env.QBO_ENCRYPTION_KEY;
  if (!hexKey || hexKey.length !== 64) {
    throw new Error(
      'QBO_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hexKey, 'hex');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a colon-delimited string: "<iv>:<authTag>:<ciphertext>" (all hex).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv  = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag(); // 128-bit GCM authentication tag

  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

/**
 * Decrypts a ciphertext produced by encrypt().
 * Throws if the auth tag does not match (tampered data).
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format: expected iv:tag:data');
  }
  const [ivHex, tagHex, dataHex] = parts;
  const iv        = Buffer.from(ivHex,  'hex');
  const tag       = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}
