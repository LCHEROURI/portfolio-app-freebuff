import { NextResponse, type NextRequest } from 'next/server';

import { readScannedRepositories } from '@/lib/server/scans';
import { getRequestUserId } from '@/lib/server/user';

export const dynamic = 'force-dynamic';

// ============================================================================
// GET /api/scans — scanner feed for the Settings 'Local scan schedule' card,
// the LastScanStrip freshness strip, and any other surface that wants to show
// per-repo scan freshness ('scanned just now / stale scan').
//
// The feed comes from readScannedRepositories, which is source-aware:
//   - With FIREBASE_SERVICE_ACCOUNT configured (production), it reads the
//     Firestore `repositories` collection rows that carry `lastScannedAt`
//     (written by POST /api/scanner). This is the real production path: the
//     local machine POSTs its scans and the serverless app serves them.
//   - Without a service account (local dev), it reads data/scans.json, the
//     same server-side file /api/scanner writes in demo mode.
//
// Auth: the route is identity-scoped like every other live-data route. The
// acting user is resolved via getRequestUserId (verified Firebase ID token, or
// the demo x-app-user header) and the Firestore feed is read for that user
// only — the old "no auth, it's git metadata" rationale did not survive the
// move to a serverless store, where the rows are a real user's private repo
// facts. The client sends identity through lib/liveData.ts's fetchScans.
// ============================================================================

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const parsed = await readScannedRepositories(userId);
    const repos = parsed
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s) => ({
        id: typeof s.id === 'string' ? s.id : '',
        owner: typeof s.owner === 'string' ? s.owner : '',
        repositoryName: typeof s.repositoryName === 'string' ? s.repositoryName : '',
        repositoryUrl: typeof s.repositoryUrl === 'string' ? s.repositoryUrl : '',
        currentBranch: typeof s.currentBranch === 'string' ? s.currentBranch : 'main',
        lastScannedAt: typeof s.lastScannedAt === 'string' ? s.lastScannedAt : '',
        hasUncommittedChanges: Boolean(s.hasUncommittedChanges),
        hasUnpushedCommits: Boolean(s.hasUnpushedCommits),
        commitsAhead: Number(s.commitsAhead ?? 0),
        commitsBehind: Number(s.commitsBehind ?? 0),
      }))
      .filter((r) => r.repositoryName)
      .sort((a, b) => b.lastScannedAt.localeCompare(a.lastScannedAt));

    return NextResponse.json({ ok: true, repos, file: 'data/scans.json' });
  } catch {
    // No scans yet, or unreadable (read-only fs / missing file) — empty feed.
    return NextResponse.json({ ok: true, repos: [], file: 'data/scans.json' });
  }
}
