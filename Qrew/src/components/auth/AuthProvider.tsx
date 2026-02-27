// src/components/auth/AuthProvider.tsx
// React Context provider that manages Firebase authentication state for the entire app.
// Wrap the component tree with <AuthProvider> (done in layout.tsx) so any child component
// can call useAuth() to access the current user and sign-in/sign-out functions.
'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';
import { getUser, getUserByEmail, createUser } from '@/lib/db';
import type { User } from '@/types';

// Shape of the value provided to all consumers of AuthContext
interface AuthContextType {
  user: User | null;                 // HOI app user record from Firestore (null if not signed in)
  firebaseUser: FirebaseUser | null; // Raw Firebase Auth user (contains photo, email, uid)
  loading: boolean;                  // True while the initial auth state is being resolved
  signIn: () => Promise<void>;       // Opens the Google OAuth popup
  signOut: () => Promise<void>;      // Signs out of Firebase Auth
}

// Default context value used when a component accesses the context outside of an AuthProvider.
// loading: true prevents flash-of-unauthenticated-content before the provider mounts.
const AuthContext = createContext<AuthContextType>({
  user: null,
  firebaseUser: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
});

// Convenience hook — import and call useAuth() in any client component to get auth state
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  // Start as true; flipped to false once onAuthStateChanged fires for the first time
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // onAuthStateChanged fires immediately with the current session (or null if no session),
    // then again on every subsequent sign-in/sign-out. The returned function unsubscribes.
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      try {
        setFirebaseUser(fbUser);

        if (fbUser) {
          // Load user from Firestore — first try by UID (fast path for returning users)
          let dbUser = await getUser(fbUser.uid);

          if (!dbUser) {
            // UID lookup failed — check if an ED pre-created the account by email
            dbUser = await getUserByEmail(fbUser.email!);

            if (!dbUser) {
              // Assign ED role if this email matches the configured ED address,
              // otherwise default to TO (lowest privilege). The ED can change roles later.
              const edEmail = process.env.NEXT_PUBLIC_ED_EMAIL;
              const isEd = edEmail && fbUser.email === edEmail;
              await createUser(fbUser.uid, {
                googleSubject: fbUser.uid,
                email: fbUser.email!,
                displayName: fbUser.displayName || fbUser.email!,
                role: isEd ? 'ED' : 'TO',
                workerTier: isEd ? undefined : 'TO',
                active: true,
                managerWorksites: [],
                createdAt: new Date(),
              });
              // Re-fetch so dbUser contains the freshly written document's data
              dbUser = await getUser(fbUser.uid);
            }
          }

          setUser(dbUser);
        } else {
          // User signed out — clear the Firestore user record from state
          setUser(null);
        }
      } catch (error) {
        // Firestore or auth error — log it and fall through so loading clears
        console.error('Auth state resolution error:', error);
        setUser(null);
      } finally {
        // Always clear loading, even if an error occurred above
        setLoading(false);
      }
    });

    // Clean up the Firebase listener when the AuthProvider unmounts
    return () => unsubscribe();
  }, []);

  // Opens a Google OAuth popup restricted to the HOI Workspace domain (configured in firebase.ts).
  // After a successful sign-in, onAuthStateChanged fires automatically.
  const signIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  };

  // Signs the user out of Firebase Auth. onAuthStateChanged fires with null afterwards.
  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, firebaseUser, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
