import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, type Auth, type User } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getFunctions, type Functions } from 'firebase/functions';

/**
 * Firebase is optional in this workspace: when no project config is present
 * the app falls back to a fully functional local (localStorage-backed) demo
 * store so the Command Center can be developed, tested, and demoed without
 * credentials. When `NEXT_PUBLIC_FIREBASE_*` env vars ARE present, real
 * Authentication + Firestore are used (Phase 3), and the app gates the UI
 * behind a sign-in screen.
 */

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export const readFirebaseConfig = (): FirebaseConfig | null => {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!apiKey || !projectId) return null;
  return {
    apiKey,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  };
};

export const isFirebaseConfigured = (): boolean => {
  if (typeof window === 'undefined') return false;
  return readFirebaseConfig() !== null;
};

let app: FirebaseApp | null = null;

export const getFirebaseApp = (): FirebaseApp | null => {
  if (!isFirebaseConfigured()) return null;
  if (!app) {
    const config = readFirebaseConfig();
    if (!config) return null;
    app = getApps().length ? getApp() : initializeApp(config);
  }
  return app;
};

export const getFirebaseAuth = (): Auth | null => {
  const a = getFirebaseApp();
  return a ? getAuth(a) : null;
};

export const getFirestoreDb = (): Firestore | null => {
  const a = getFirebaseApp();
  return a ? getFirestore(a) : null;
};

export const getFirebaseFunctions = (): Functions | null => {
  const a = getFirebaseApp();
  return a ? getFunctions(a) : null;
};

/**
 * Resolve the current user id for Firestore user isolation.
 *
 * - Firebase mode: returns the signed-in user's uid. Phase 3 requires a real
 *   account (the UI gates behind sign-in), so there is no anonymous fallback.
 * - Demo mode: returns a stable per-browser local id.
 *
 * Throws when Firebase is configured but nobody is signed in — callers in the
 * auth-gated store only reach this after authentication.
 */
export const getUserId = async (): Promise<string> => {
  const auth = getFirebaseAuth();
  if (!auth) {
    let id = localStorage.getItem('apcc-local-uid');
    if (!id) {
      id = `local-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('apcc-local-uid', id);
    }
    return id;
  }
  const current = auth.currentUser;
  if (current) return current.uid;
  throw new Error('Sign in to sync your Command Center.');
};

export const subscribeToUser = (cb: (user: User | null) => void): (() => void) => {
  const auth = getFirebaseAuth();
  if (!auth) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth, cb);
};
