import { afterEach, describe, expect, it } from 'vitest';

import { isFirebaseConfigured } from './firebase';

// ─── Env helpers ────────────────────────────────────────────────────────────
const CONFIG_KEYS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_DEMO_OVERRIDE',
];

afterEach(() => {
  for (const key of CONFIG_KEYS) delete process.env[key];
});

describe('isFirebaseConfigured', () => {
  it('is false when no Firebase env vars are set (demo mode)', () => {
    expect(isFirebaseConfigured()).toBe(false);
  });

  it('is true when the Firebase web config is present', () => {
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'test-key';
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'test-project';
    expect(isFirebaseConfigured()).toBe(true);
  });

  it('forces demo mode when NEXT_PUBLIC_DEMO_OVERRIDE=1 even with Firebase vars present', () => {
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'test-key';
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'test-project';
    process.env.NEXT_PUBLIC_DEMO_OVERRIDE = '1';
    expect(isFirebaseConfigured()).toBe(false);
  });

  it('ignores a non-1 demo override value (real accounts stay on Firebase)', () => {
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'test-key';
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'test-project';
    process.env.NEXT_PUBLIC_DEMO_OVERRIDE = '0';
    expect(isFirebaseConfigured()).toBe(true);
  });
});
