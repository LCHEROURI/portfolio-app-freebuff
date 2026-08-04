'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, RefreshCw } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ScanFreshnessBadge } from '@/components/ui/ScanFreshnessBadge';
import { LocalScanHeader } from '@/components/dashboard/LocalScanHeader';
import { timeAgo } from '@/lib/engine';
import { SCAN_STALE_MS } from '@/lib/scan';

interface ScanRow {
  id: string;
  owner: string;
  repositoryName: string;
  lastScannedAt: string;
  hasUncommittedChanges: boolean;
  hasUnpushedCommits: boolean;
}

const repoName = (r: ScanRow) => `${r.owner}/${r.repositoryName}`;

/**
 * 'Last scan' freshness strip for the Command Center metric cards. Reads the
 * local scanner feed (GET /api/scans — the same data/scans.json the cron
 * snapshot overlays) and shows the NEWEST and OLDEST lastScannedAt across
 * repos with the shared fresh/stale badge. Each row is a link to the
 * Repositories page scrolled to that repo, so the strip doubles as a nav hub.
 *
 * `headerAction` renders an optional link beside the 'Local scan' label
 * (e.g. the launchd schedule on the Reports page).
 */
export const LastScanStrip = ({ headerAction }: { headerAction?: ReactNode }) => {
  const [rows, setRows] = useState<ScanRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/scans', { cache: 'no-store' });
      const json = (await res.json()) as { ok: boolean; repos: ScanRow[] };
      setRows(Array.isArray(json.repos) ? json.repos : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const newest = rows && rows.length > 0
    ? rows.reduce((a, b) => (a.lastScannedAt > b.lastScannedAt ? a : b))
    : null;
  const oldest = rows && rows.length > 0
    ? rows.reduce((a, b) => (a.lastScannedAt < b.lastScannedAt ? a : b))
    : null;
  const staleCount = (rows ?? []).filter(
    (r) => Date.now() - new Date(r.lastScannedAt).getTime() > SCAN_STALE_MS,
  ).length;

  // Clickable row: deep-links to /repositories?repo=owner/name, which the
  // Repositories page uses to scroll that card into view.
  const repoLink = (r: ScanRow) => (
    <Link
      href={`/repositories?repo=${encodeURIComponent(repoName(r))}`}
      aria-label={`Open Repositories scrolled to ${repoName(r)}`}
      className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-butter-100 dark:hover:bg-pepper-700"
      title={`Open Repositories scrolled to ${repoName(r)}`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-pepper-900 group-hover:text-tomato-600 dark:text-flour-50 dark:group-hover:text-tomato-300">
          {repoName(r)}
        </p>
        <p className="truncate text-xs text-pepper-400">captured {timeAgo(r.lastScannedAt)}</p>
      </div>
      {r.lastScannedAt && (
        <span className="shrink-0">
          <ScanFreshnessBadge scannedAt={r.lastScannedAt} />
        </span>
      )}
      <ArrowRight size={13} className="shrink-0 text-pepper-300 transition-transform group-hover:translate-x-0.5 group-hover:text-tomato-500 dark:text-pepper-500" aria-hidden="true" />
    </Link>
  );

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <LocalScanHeader action={headerAction} />

        {loading ? (
          <p className="text-sm text-pepper-400">Loading scan freshness…</p>
        ) : rows && rows.length === 0 ? (
          <p className="text-sm text-pepper-500 dark:text-pepper-300">
            No local scans yet — run <code className="font-mono">npm run scan:all</code> once to seed the feed.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              {newest && repoLink(newest)}
              <span className="text-xs text-pepper-400" aria-hidden="true">←</span>
              {oldest && repoLink(oldest)}
              <span className="text-xs text-pepper-400" aria-hidden="true">→</span>
            </div>

            {staleCount > 0 && (
              <Badge tone="turmeric" title={`${staleCount} repo(s) have a scan older than 24h`}>
                {staleCount} stale
              </Badge>
            )}

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-pepper-400">{rows!.length} repos</span>
              <button
                type="button"
                aria-label="Refresh local scan freshness"
                className="btn-ghost px-2 py-1 text-xs"
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
                Refresh
              </button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
};
