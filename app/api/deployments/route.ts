import { NextResponse, type NextRequest } from 'next/server';

import { fetchLiveDeployments } from '@/lib/server/deployments';
import { getRequestUserId } from '@/lib/server/user';

// ============================================================================
// GET /api/deployments — live deployment feed (Vercel + Firebase + health
// checks). Delegates to the shared lib/server/deployments.ts, also used by the
// automation cron so reports reflect the same live state as this view.
// ============================================================================

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });

  const deployments = await fetchLiveDeployments(userId);
  const configured = Boolean(process.env.VERCEL_TOKEN) || Boolean(process.env.FIREBASE_TOKEN) || deployments.length > 0;

  return NextResponse.json({
    ok: true,
    configured,
    source: process.env.VERCEL_TOKEN ? 'vercel' : process.env.FIREBASE_TOKEN ? 'firebase' : 'none',
    deployments,
  });
}
