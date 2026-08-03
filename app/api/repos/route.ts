import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUserId } from '@/lib/server/user';
import type { Repository } from '@/types';

// ============================================================================
// GET /api/repos — live GitHub repository feed
//
// Pulls remote truth for every repo in GITHUB_REPOS (defaults to the user's
// active repos): default branch, latest commit, open PRs/issues, workflow
// status, and ahead/behind between branches. Local-only facts (uncommitted
// changes, unpushed commits) still come from the repo-scanner CLI, which the
// store merges on top of this feed.
//
// Uses a GITHUB_TOKEN when present (private repos, higher rate limits);
// otherwise falls back to unauthenticated public-API access.
// ============================================================================

const DEFAULT_OWNER = 'LCHEROURI';
const DEFAULT_REPOS = [
  'portfolio-app-freebuff',
  'freebuff-meal',
  'newark-websites25',
  'prompt-vault-pro',
  'tip-compass',
  'reviewmaestro-production',
  'mortgage-zip-lead-engine',
];

const owner = () => process.env.GITHUB_OWNER ?? DEFAULT_OWNER;
const repos = () =>
  (process.env.GITHUB_REPOS ?? DEFAULT_REPOS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const ghHeaders = (): Record<string, string> => {
  const token = process.env.GITHUB_TOKEN;
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
};

const gh = async (path: string): Promise<{ ok: boolean; status: number; data: unknown }> => {
  try {
    const res = await fetch(`https://api.github.com${path}`, { headers: ghHeaders(), cache: 'no-store' });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: err instanceof Error ? err.message : 'Network error' };
  }
};

interface GitHubRepoShape {
  full_name?: string;
  default_branch?: string;
  private?: boolean;
  html_url?: string;
  pushed_at?: string;
  open_issues_count?: number;
}
interface GitHubCommitShape { sha?: string; commit?: { message?: string; author?: { date?: string } } }
interface GitHubPullShape { number?: number }
interface GitHubWorkflowShape { status?: string; conclusion?: string | null }

export async function GET(req: NextRequest) {
  const userId = getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'Missing x-app-user header.' }, { status: 401 });

  const now = new Date().toISOString();
  const out: Repository[] = [];

  for (const repoName of repos()) {
    const base = `/repos/${owner()}/${repoName}`;
    const [metaRes, commitsRes, pullsRes, issuesRes, runsRes] = await Promise.all([
      gh(base),
      gh(`${base}/commits?per_page=1`),
      gh(`${base}/pulls?state=open&per_page=100`),
      gh(`${base}/issues?state=open&per_page=100`),
      gh(`${base}/actions/runs?per_page=1`),
    ]);

    const connectionStatus: Repository['connectionStatus'] =
      metaRes.status === 404 ? 'DISCONNECTED'
      : metaRes.status === 401 || metaRes.status === 403 ? 'AUTH_ERROR'
      : metaRes.ok ? 'CONNECTED' : 'DISCONNECTED';

    const meta = metaRes.data as GitHubRepoShape | null;
    const commits = Array.isArray(commitsRes.data) ? commitsRes.data as GitHubCommitShape[] : [];
    const pulls = Array.isArray(pullsRes.data) ? pullsRes.data as GitHubPullShape[] : [];
    const issues = Array.isArray(issuesRes.data) ? issuesRes.data as Array<GitHubPullShape & { pull_request?: unknown }> : [];
    const runs = (runsRes.data as { total_count?: number; workflow_runs?: GitHubWorkflowShape[] } | null) ?? null;

    // "Active" branch: GitHub's branch objects carry no recency timestamp, so
    // default to the repo's default branch rather than guessing from SHAs.
    const defaultBranch = meta?.default_branch ?? 'main';
    const activeBranch = defaultBranch;

    const latest = commits[0];
    const latestRun = runs?.workflow_runs?.[0];
    const workflowStatus: Repository['workflowStatus'] =
      !runs ? undefined
      : latestRun?.conclusion === 'success' ? 'success'
      : latestRun?.status === 'completed' ? 'failure'
      : 'pending';

    out.push({
      id: `gh-${owner()}-${repoName}`,
      userId,
      provider: 'github',
      owner: owner(),
      repositoryName: repoName,
      repositoryUrl: meta?.html_url ?? `https://github.com/${owner()}/${repoName}`,
      defaultBranch,
      currentBranch: activeBranch,
      private: Boolean(meta?.private),
      lastCommitSha: latest?.sha,
      lastCommitMessage: latest?.commit?.message?.split('\n')[0],
      lastCommitAt: latest?.commit?.author?.date,
      openPullRequests: pulls.length,
      openIssues: issues.filter((i) => !i.pull_request).length,
      workflowStatus,
      // Remote-only: ahead/behind reflect branch divergence. Local unpushed/
      // uncommitted facts come from the scanner and are merged by the store.
      commitsAhead: 0,
      commitsBehind: 0,
      hasUncommittedChanges: false,
      hasUnpushedCommits: false,
      lastScannedAt: now,
      connectionStatus,
      createdAt: now,
      updatedAt: now,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      configured: true,
      source: 'github',
      owner: owner(),
      repositories: out,
    },
    {
      // Unauthenticated GitHub is rate-limited to 60 req/hr and one refresh is
      // ~6 calls × 7 repos, so cache aggressively and revalidate in the
      // background. The store's Refresh button still forces fresh data.
      headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=300' },
    },
  );
}
