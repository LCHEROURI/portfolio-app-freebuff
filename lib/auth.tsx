'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';

import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/firebase';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
}

export type AuthMode = 'demo' | 'firebase';

interface AuthApi {
  mode: AuthMode;
  user: AuthUser | null;
  /** True while Firebase auth state is still resolving. */
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

const toAuthUser = (u: FirebaseUser): AuthUser => ({
  uid: u.uid,
  email: u.email,
  displayName: u.displayName,
  emailVerified: u.emailVerified,
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const mode: AuthMode = isFirebaseConfigured() ? 'firebase' : 'demo';
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(mode === 'firebase');

  useEffect(() => {
    if (mode === 'demo') {
      setInitializing(false);
      return;
    }
    const auth = getFirebaseAuth();
    if (!auth) {
      setInitializing(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u ? toAuthUser(u) : null);
      setInitializing(false);
    });
    return () => unsub();
  }, [mode]);

  const requireAuth = useCallback(() => {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error('Firebase is not configured.');
    return auth;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(requireAuth(), email, password);
  }, [requireAuth]);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const auth = requireAuth();
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // Account creation is the success point; a display-name set failure must not
    // surface as a failed signup (the user is already signed in).
    if (displayName && cred.user) {
      try {
        await updateProfile(cred.user, { displayName });
      } catch (e) {
        console.warn('Could not set display name after signup:', e);
      }
    }
  }, [requireAuth]);

  const signInWithGoogle = useCallback(async () => {
    const auth = requireAuth();
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }, [requireAuth]);

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (auth) await firebaseSignOut(auth);
    setUser(null);
  }, []);

  const api = useMemo<AuthApi>(
    () => ({ mode, user, initializing, signIn, signUp, signInWithGoogle, signOut }),
    [mode, user, initializing, signIn, signUp, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthApi => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
