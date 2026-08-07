'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, FileDiff, RefreshCw } from 'lucide-react';

import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ScanFreshnessBadge } from '@/components/ui/ScanFreshnessBadge';
import { fetchScans, type ScansRow } from '@/lib/liveData';
import { useStore } from '@/lib/store';

interface ScannedRepo {
  id: string;
  owner: string;
  repositoryName: string;
  currentBranch: string;
  lastScannedAt: string;
  hasUncommittedChanges: boolean;
  hasUnpushedCommits: boolean;
}

const INSTALL_CMDS = [
  { cmd: 'npm run scan:schedule install', hint: 'Installs a launchd agent that runs scan-all --notify, then seed-in-app-reports, every morning at 06:30 (before the 07:00 daily report).' },
  { cmd: 'npm run scan:schedule status', hint: 'Shows whether the agent is loaded and tails the last scan log lines.' },
  { cmd: 'npm run scan:schedule uninstall', hint: 'Stops the agent and removes the launchd plist.' },
  { cmd: 'npm run scan:schedule cron', hint: 'Prints the crontab alternative line if you prefer cron over launchd.' },
];

export const LocalScanScheduleCard = () => {
  const { userId } = useStore();
  const [repos, setRepos] = useState<ScannedRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Identity-aware: the route is user-scoped (Firestore-backed feed).
      const json = await fetchScans(userId);
      setRepos((json.repos as ScansRow[]) ?? []);
    } catch {
      setError('Could not load local scan data. Start the dev server (npm run dev) to read data/scans.json.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(cmd);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard unavailable — command is still visible in the pre block.
    }
  };

  return (
    <Card id="scan-schedule">
      <CardHeader
        title="Local scan schedule"
        subtitle="Automate the local repo scanner so unpushed/uncommitted facts are fresh when the morning report sends."
        action={<CalendarClock size={18} className="text-tomato-500" aria-hidden="true" />}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ─── Schedule docs ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          <p className="text-sm text-pepper-600 dark:text-pepper-200">
            The scanner runs on <strong>this machine</strong> via launchd (macOS) or cron, then{' '}
            <code className="font-mono">--notify</code> regenerates the daily report with the fresh
            facts, and <code className="font-mono">seed-in-app-reports</code> saves the composed report
            into the in-app Reports feed (emailed reports are disabled).
          </p>

          <div className="space-y-2">
            {INSTALL_CMDS.map(({ cmd, hint }) => (
              <div key={cmd} className="rounded-lg border border-butter-200 bg-butter-50 p-3 dark:border-pepper-700 dark:bg-pepper-800">
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-xs text-pepper-800 dark:text-flour-100">{cmd}</code>
                  <button
                    type="button"
                    aria-label={`Copy ${cmd}`}
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-tomato-600 hover:bg-butter-100 dark:text-tomato-300 dark:hover:bg-pepper-700"
                    onClick={() => void copy(cmd)}
                  >
                    {copied === cmd ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-pepper-500 dark:text-pepper-300">{hint}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-pepper-400">
            Schedule: <code className="font-mono">06:30 local time</code>, adjustable with{' '}
            <code className="font-mono">SCAN_HOUR</code> / <code className="font-mono">SCAN_MINUTE</code> when
            installing. Logs land in <code className="font-mono">.freebuff/scan-all.log</code>.
          </p>
        </div>

        {/* ─── Last scan per repo ────────────────────────────────────────── */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-pepper-900 dark:text-flour-50">Last scan per repo</h3>
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="py-6 text-center text-sm text-pepper-400">Loading local scans…</p>
          ) : error ? (
            <p className="rounded-lg border border-paprika-200 bg-paprika-50 p-3 text-xs text-paprika-700 dark:border-paprika-800 dark:bg-paprika-950 dark:text-paprika-300">
              {error}
            </p>
          ) : repos.length === 0 ? (
            <p className="rounded-lg border border-butter-200 bg-butter-50 p-3 text-sm text-pepper-500 dark:border-pepper-700 dark:bg-pepper-800 dark:text-pepper-300">
              No local scans yet. Run <code className="font-mono">npm run scan:all</code> once to seed{' '}
              <code className="font-mono">data/scans.json</code>.
            </p>
          ) : (
            <ul className="divide-y divide-butter-200 dark:divide-pepper-700">
              {repos.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-pepper-900 dark:text-flour-50">
                      {r.owner}/{r.repositoryName}
                    </p>
                    <p className="truncate text-xs text-pepper-400">
                      <code className="font-mono">{r.currentBranch}</code>
                      {r.hasUncommittedChanges && <Badge tone="turmeric" className="ml-2">uncommitted</Badge>}
                      {r.hasUnpushedCommits && <Badge tone="tomato" className="ml-2">unpushed</Badge>}
                    </p>
                  </div>
                  <span className="shrink-0">
                    {r.lastScannedAt ? (
                      <ScanFreshnessBadge scannedAt={r.lastScannedAt} />
                    ) : (
                      <Badge tone="pepper"><FileDiff size={11} aria-hidden="true" /> never</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
};
