// src/lib/firebase.ts
// Initializes the Firebase SDK for use in the Next.js frontend.
// Exports the app, auth, Firestore db, and a pre-configured Google OAuth provider.
// All NEXT_PUBLIC_ env vars are safe to expose in the browser; they identify the project
// but do not grant any server-side privileges (Firestore security rules handle access control).

import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase project configuration sourced from environment variables.
// Copy .env.example to .env.local and fill in the values from the Firebase console.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Guard against re-initialization when Next.js hot-reloads modules in development.
// getApps() returns existing app instances; we reuse the first one if it already exists.
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Firebase Auth instance used for sign-in/sign-out and auth state observation
const auth = getAuth(app);

// Firestore database instance used for all CRUD operations (see src/lib/db.ts)
const db = getFirestore(app);

// Configure Google Auth Provider to only allow HOI workspace domain.
// The `hd` (hosted domain) parameter restricts the account picker to the specified
// Google Workspace domain, so personal Gmail accounts are rejected at the OAuth screen.
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  hd: process.env.NEXT_PUBLIC_HOI_WORKSPACE_DOMAIN || 'housingopps.org',
  // Always show the account picker even if the user is already signed in,
  // so workers on shared devices can choose the correct account
  prompt: 'select_account'
});

export { app, auth, db, googleProvider };
