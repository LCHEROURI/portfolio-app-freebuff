import { NextResponse, type NextRequest } from 'next/server';

import { normalizeProjectOrigin } from '@/lib/authDomains';
import { checkIntegrations } from '@/lib/server/status';
import { getRequestUserId } from '@/lib/server/user';

// ============================================================================
// GET /api/status — integration connection status.
//
// Owner-scoped like every live route (verified Firebase ID token when Firebase
// is configured, local id in demo mode). Returns which env vars are set
// (booleans only — never values) and a live endpoint ping per integration:
// Firestore (REST when a service account is set), GitHub (rate_limit), Vercel
// (user API), Firebase (projects API when a hosting token is set), and the
// automation engine.
// ============================================================================

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  }

  // ?refresh=1 bypasses the per-check ping cache (used by the panel's Refresh
  // button so a manual refresh always re-pings the providers).
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  // The request origin is the domain Firebase's sign-in gate compares against —
  // used by the Firebase authorized-domains check.
  const origin = req.nextUrl.origin;
  // ?project=<origin-or-hostname> overrides that origin so a deployment
  // preview domain can be validated BEFORE it ships: the check runs from the
  // current origin but evaluates the override hostname against the project's
  // authorized list. Invalid values fall back to the request origin.
  const projectParam = req.nextUrl.searchParams.get('project');
  const projectOrigin = projectParam ? normalizeProjectOrigin(projectParam) : null;
  const integrations = await checkIntegrations(refresh, origin, projectOrigin ?? undefined);
  return NextResponse.json(
    { ok: true, checkedAt: new Date().toISOString(), integrations },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
