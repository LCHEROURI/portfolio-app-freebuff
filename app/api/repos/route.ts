import { NextResponse, type NextRequest } from 'next/server';

import { fetchGitHubRepos } from '@/lib/server/github';
import { getRequestUserId } from '@/lib/server/user';

// ============================================================================
// GET /api/repos — live GitHub repository feed.
// Delegates to the shared lib/server/github.ts (also used by the automation
// cron) so the client view and the emailed reports always see the same truth.
// ============================================================================

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });

  const repositories = await fetchGitHubRepos(userId);

  return NextResponse.json(
    {
      ok: true,
      configured: true,
      source: 'github',
      owner: process.env.GITHUB_OWNER ?? 'LCHEROURI',
      repositories,
    },
    {
      // Unauthenticated GitHub is rate-limited to 60 req/hr and one refresh is
      // ~6 calls × 7 repos, so cache aggressively and revalidate in the
      // background. The store's Refresh button still forces fresh data.
      headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=300' },
    },
  );
}
