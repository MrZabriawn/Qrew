// src/lib/adminFirebase.ts
// Firebase Admin SDK singleton for use in Next.js API route handlers (server-side only).
//
// IMPORTANT: This file MUST NOT be imported by any client component. The Admin SDK
// contains service-account credentials and has full Firestore access that bypasses
// security rules.
//
// Credentials are loaded from three environment variables (set in .env.local and in
// Firebase Hosting environment config for production):
//   FIREBASE_ADMIN_PROJECT_ID
//   FIREBASE_ADMIN_CLIENT_EMAIL
//   FIREBASE_ADMIN_PRIVATE_KEY   (include the full PEM block; newlines encoded as \n in env)
//
// The singleton pattern prevents multiple admin app instances on Next.js hot-reload.

import * as admin from 'firebase-admin';

function initAdmin(): admin.app.App {
  if (admin.apps.length > 0) {
    return admin.apps[0]!;
  }

  const projectId   = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing Firebase Admin credentials. ' +
      'Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, ' +
      'and FIREBASE_ADMIN_PRIVATE_KEY in your environment.'
    );
  }

  return admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

// Lazily initialised on first import — safe across Next.js hot reloads
const app = initAdmin();

export const adminDb   = admin.firestore(app);
export const adminAuth = admin.auth(app);
export { admin };
