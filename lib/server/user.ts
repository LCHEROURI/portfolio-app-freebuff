import type { NextRequest } from 'next/server';

/**
 * Resolve the acting user id for live-data API routes.
 *
 * The client sends `x-app-user` (the store's userId: a Firebase uid in
 * Firebase mode, or the stable local id in demo mode). In production with
 * Firebase wired up, the App Layout gates everything behind a signed-in user,
 * so the header value is the authenticated uid. A future hardening step can
 * verify a Firebase ID token server-side; for now the header matches the
 * existing user-isolation model used across the data layer.
 */
export const getRequestUserId = (req: NextRequest): string | null =>
  req.headers.get('x-app-user');
