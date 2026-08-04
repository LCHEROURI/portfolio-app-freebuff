'use client';

import { GitBranch, ExternalLink, ArrowUpFromLine, FileDiff, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader, StatCard } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScanFreshnessBadge } from '@/components/ui/ScanFreshnessBadge';
import { useStore } from '@/lib/store';
import { timeAgo } from '@/lib/engine';
import { PROVIDER_LABELS } from '@/lib/labels';

export default function RepositoriesPage() {
  const store = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const [highlightedRepo, setHighlightedRepo] = useState<string | null>(null);
  const repos = [...store.repositories].sort((a, b) => b.lastScannedAt.localeCompare(a.lastScannedAt));
  const unpushed = repos.filter((r) => r.hasUnpushedCommits).length;
  const dirty = repos.filter((r) => r.hasUncommittedChanges).length;
  const live = store.live.repositories;

  // Deep link from the Command Center LastScanStrip (?repo=owner/name): scroll
  // the matching card into view and flash a highlight ring so the navigation
  // lands visibly instead of silently dropping onto the page. Depends on a
  // stable repo signature (not the fresh array identity) so the 2.5s highlight
  // timer isn't reset on every re-render.
  const repoSignature = repos.map((r) => r.id).join('|');
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get('repo');
    if (!target) return;
    const el = document.querySelector(`[data-repo-key="${CSS.escape(target)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedRepo(target);
    const t = setTimeout(() => setHighlightedRepo(null), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoSignature]);

  const versionLabel = (id?: string) => {
    if (!id) return 'No linked version';
    const v = store.versions.find((x) => x.id === id);
    if (!v) return 'Unknown version';
    const p = store.projects.find((x) => x.id === v.projectId);
    return `${p?.name ?? 'Project'} / ${v.versionName}`;
  };

  const refresh = async () => {
    setRefreshing(true);
    try { await store.refreshLive(); } finally { setRefreshing(false); }
  };

  return (
    <div>
      <PageHeader
        title="Repositories"
        description={live
          ? 'Live from the GitHub API — branches, commits, PRs, issues, and workflow status for your active repos.'
          : 'Git repositories linked to your builds, updated by the local scanner companion.'}
        action={
          <button type="button" className="btn-secondary" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {live && (
        <div className="mb-4 flex items-center gap-2 text-xs text-pepper-500 dark:text-pepper-300">
          <Badge tone="basil"><GitBranch size={11} aria-hidden="true" /> GitHub API</Badge>
          <span>Remote data refreshed on demand. Local uncommitted/unpushed flags still come from the scanner CLI and are overlaid on these repos.</span>
        </div>
      )}

      <section aria-label="Repository metrics" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Connected repos" value={repos.length} icon={<GitBranch size={20} aria-hidden="true" />} tone="eggplant" />
        <StatCard label="Unpushed commits" value={unpushed} icon={<ArrowUpFromLine size={20} aria-hidden="true" />} tone={unpushed > 0 ? 'tomato' : 'basil'} />
        <StatCard label="Uncommitted changes" value={dirty} icon={<FileDiff size={20} aria-hidden="true" />} tone={dirty > 0 ? 'turmeric' : 'basil'} />
      </section>

      {/* Scanner instructions */}
      <Card className="mb-6">
        <CardHeader
          title="Local Repository Scanner"
          subtitle="Point the CLI at any local folder to push git metadata to this Command Center (no source code is ever uploaded)."
        />
        <div className="space-y-2 text-sm">
          <p className="text-pepper-600 dark:text-pepper-200">Run from a terminal in the app folder:</p>
          <pre className="overflow-x-auto rounded-xl2 bg-pepper-900 p-4 font-mono text-xs leading-relaxed text-flour-50">
{`node scripts/repo-scanner.mjs \\\
  --path ~/dev/weeknight-planner/gemini \\\
  --api http://localhost:3000/api/scanner \\\
  --project-version "v-xxxx"`}
          </pre>
          <p className="text-xs text-pepper-400">
            The scanner reads <code className="font-mono">git status --porcelain</code>, <code className="font-mono">git remote -v</code>,{' '}
            <code className="font-mono">git branch --show-current</code>, <code className="font-mono">git log -1</code> and{' '}
            <code className="font-mono">git rev-list --left-right --count</code>, then POSTs metadata to the Command Center API.
          </p>
        </div>
      </Card>

      {repos.length === 0 ? (
        <EmptyState icon={<GitBranch size={32} aria-hidden="true" />} title="No repositories yet" description="Run the scanner above or link a repository to a version to see it here." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {repos.map((r) => {
            const repoKey = `${r.owner}/${r.repositoryName}`;
            return (
            <Card
              key={r.id}
              data-repo-key={repoKey}
              className={`flex flex-col scroll-mt-24 ${highlightedRepo === repoKey ? 'ring-2 ring-tomato-500' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-display text-base font-bold">{r.owner}/{r.repositoryName}</h3>
                  <p className="text-xs text-pepper-400">{PROVIDER_LABELS[r.provider]} · {r.currentBranch}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={r.connectionStatus === 'CONNECTED' ? 'basil' : r.connectionStatus === 'AUTH_ERROR' ? 'paprika' : 'turmeric'}>
                    {r.connectionStatus.replace(/_/g, ' ')}
                  </Badge>
                  {r.lastScannedAt && (
                    <ScanFreshnessBadge scannedAt={r.lastScannedAt} />
                  )}
                </div>
              </div>

              <p className="mt-1 text-xs text-pepper-500 dark:text-pepper-300">
                {versionLabel(r.projectVersionId)}
              </p>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-butter-100 p-2 dark:bg-pepper-700">
                  <p className="text-sm font-bold">{r.commitsAhead}</p>
                  <p className="text-[10px] uppercase text-pepper-400">ahead</p>
                </div>
                <div className="rounded-lg bg-butter-100 p-2 dark:bg-pepper-700">
                  <p className="text-sm font-bold">{r.commitsBehind}</p>
                  <p className="text-[10px] uppercase text-pepper-400">behind</p>
                </div>
                <div className="rounded-lg bg-butter-100 p-2 dark:bg-pepper-700">
                  <p className="text-sm font-bold">{r.openPullRequests}</p>
                  <p className="text-[10px] uppercase text-pepper-400">PRs</p>
                </div>
              </div>

              {live && r.lastCommitMessage && (
                <p className="mt-2 truncate rounded-lg bg-butter-100 px-2.5 py-1.5 text-xs text-pepper-600 dark:bg-pepper-700 dark:text-pepper-200">
                  <span className="font-mono">{r.lastCommitSha?.slice(0, 7)}</span> · {r.lastCommitMessage}
                </p>
              )}

              {(r.hasUncommittedChanges || r.hasUnpushedCommits) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.hasUncommittedChanges && <Badge tone="turmeric">uncommitted changes</Badge>}
                  {r.hasUnpushedCommits && <Badge tone="tomato">unpushed commits</Badge>}
                </div>
              )}

              <div className="mt-auto flex items-center justify-between border-t border-butter-200 pt-3 text-xs text-pepper-400 dark:border-pepper-700">
                <span>{live && r.lastCommitAt ? `committed ${timeAgo(r.lastCommitAt)}` : `scanned ${timeAgo(r.lastScannedAt)}`}</span>
                <a href={r.repositoryUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-tomato-600 hover:underline dark:text-tomato-300">
                  Open <ExternalLink size={12} aria-hidden="true" />
                </a>
              </div>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
