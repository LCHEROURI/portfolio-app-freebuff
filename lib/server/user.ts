import type { NextRequest } from 'next/server';

import { verifyFirebaseIdToken } from '@/lib/server/firebase-token';

// ============================================================================
// Resolve the acting user id for live-data API routes.
//
// Firebase mode (NEXT_PUBLIC_FIREBASE_PROJECT_ID set): owner identity comes
// from a verified Firebase ID token in `Authorization: Bearer <idToken>` —
// the `x-app-user` header is ignored entirely, so it can no longer be spoofed
// to read or write another user's rows.
//
// Demo mode (no Firebase configured): there is no token issuer to verify
// against, so the stable local id in `x-app-user` remains the only identity.
// The demo store is per-browser local data, so this poses no cross-user risk.
// ============================================================================

export const getRequestUserId = async (req: NextRequest): Promise<string | null> => {
  // NEXT_PUBLIC_DEMO_OVERRIDE=1 forces demo identity even when Firebase env
  // vars are present — mirrors the client-side isFirebaseConfigured override so
  // the demo-mode build's live routes (/api/status, /api/tasks, …) keep
  // trusting the local x-app-user header instead of 401-ing the demo client.
  if (process.env.NEXT_PUBLIC_DEMO_OVERRIDE === '1') {
    return req.headers.get('x-app-user');
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (projectId) {
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
    if (!token) return null;
    const verified = await verifyFirebaseIdToken(token, projectId);
    return verified?.uid ?? null;
  }

  return req.headers.get('x-app-user');
};
