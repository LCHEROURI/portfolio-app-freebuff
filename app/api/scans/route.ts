import { NextResponse } from 'next/server';

import { readScansFile } from '@/lib/server/scans';

export const dynamic = 'force-dynamic';

// ============================================================================
// GET /api/scans — local scanner feed for the Settings 'Local scan schedule'
// card (and any other surface that wants to show per-repo scan freshness).
//
// Reads data/scans.json, the same server-side file /api/scanner writes in demo
// mode. Returns one row per repo with its lastScannedAt so the UI can show
// 'scanned just now / stale scan' next to the documented launchd/cron schedule.
//
// The file lives at process.cwd()/data/scans.json, which only the machine that
// runs the scanner (or the local dev server) actually has; on a read-only
// serverless filesystem this degrades to an empty list, exactly like the
// scanner overlay. No auth: the payload is git metadata the owner already sees
// on their own machine.
// ============================================================================

export async function GET() {
  try {
    const parsed = await readScansFile();
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
