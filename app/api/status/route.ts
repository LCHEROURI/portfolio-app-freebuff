import { NextResponse, type NextRequest } from 'next/server';

import { checkIntegrations } from '@/lib/server/status';
import { getRequestUserId } from '@/lib/server/user';

// ============================================================================
// GET /api/status — integration connection status.
//
// Owner-scoped like every live route (verified Firebase ID token when Firebase
// is configured, local id in demo mode). Returns which env vars are set
// (booleans only — never values) and a live endpoint ping per integration:
// Supabase (PostgREST), GitHub (rate_limit), Vercel (user API), Firebase
// (projects API when a hosting token is set), and the automation engine.
// ============================================================================

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  }

  // ?refresh=1 bypasses the per-check ping cache (used by the panel's Refresh
  // button so a manual refresh always re-pings the providers).
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  const integrations = await checkIntegrations(refresh);
  return NextResponse.json(
    { ok: true, checkedAt: new Date().toISOString(), integrations },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
