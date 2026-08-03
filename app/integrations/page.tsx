'use client';

import { useEffect, useState } from 'react';
import {
  Activity, Check, Cpu, Database, ExternalLink, Github, HeartPulse,
  Plug, RefreshCw, Rocket, Wrench, X, type LucideIcon,
} from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge, type Tone } from '@/components/ui/Badge';
import { isFirebaseConfigured } from '@/lib/firebase';
import { readLiveFlags, fetchIntegrationStatus, type IntegrationStatus } from '@/lib/liveData';
import { useStore } from '@/lib/store';

// ═══════════════════════════════════════════════════════════════════════════
// Live connection-status panel — polls /api/status every 30s.
// ═══════════════════════════════════════════════════════════════════════════

const POLL_MS = 30_000;

const STATUS_ICONS: Record<string, LucideIcon> = {
  supabase: Database,
  github: Github,
  vercel: Rocket,
  firebase: HeartPulse,
  automation: Cpu,
};

const STATUS_TONES: Record<string, string> = {
  supabase: 'bg-basil-500 text-white',
  github: 'bg-pepper-800 text-white',
  vercel: 'bg-pepper-900 text-white',
  firebase: 'bg-turmeric-500 text-white',
  automation: 'bg-eggplant-700 text-white',
};

const stateOf = (s: IntegrationStatus): { tone: Tone; label: string } => {
  if (!s.configured) return { tone: 'pepper', label: 'Not configured' };
  if (s.endpoint) {
    if (s.endpoint.ok) return { tone: 'basil', label: 'Responding' };
    return { tone: 'paprika', label: 'Endpoint error' };
  }
  return s.enabled
    ? { tone: 'basil', label: 'Connected' }
    : { tone: 'turmeric', label: 'Configured · flag off' };
};

function StatusCard({ status }: { status: IntegrationStatus }) {
  const Icon = STATUS_ICONS[status.id] ?? Plug;
  const { tone, label } = stateOf(status);
  const ep = status.endpoint;

  return (
    <div className="rounded-xl2 border border-butter-200 bg-butter-50 p-4 dark:border-pepper-700 dark:bg-pepper-800">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${STATUS_TONES[status.id] ?? 'bg-pepper-800 text-white'}`}>
            <Icon size={15} aria-hidden="true" />
          </span>
          <h4 className="truncate text-sm font-semibold text-pepper-900 dark:text-flour-50">{status.name}</h4>
        </div>
        <Badge tone={tone}>{label}</Badge>
      </div>

      <ul className="mt-3 space-y-1">
        {status.env.map((v) => (
          <li key={v.name} className="flex items-center gap-1.5 font-mono text-xs">
            {v.set
              ? <Check size={12} className="shrink-0 text-basil-500" aria-hidden="true" />
              : <X size={12} className="shrink-0 text-paprika-500" aria-hidden="true" />}
            <span className={v.set ? 'text-pepper-700 dark:text-flour-200' : 'text-pepper-400 dark:text-pepper-500'}>
              {v.name}
            </span>
            {v.required && <span className="text-[10px] uppercase tracking-wide text-pepper-400 dark:text-pepper-500">req</span>}
          </li>
        ))}
      </ul>

      <div className="mt-3 border-t border-butter-200 pt-2 text-xs dark:border-pepper-700">
        {ep ? (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-pepper-600 dark:text-pepper-300">
            <span className={`h-2 w-2 rounded-full ${ep.ok ? 'bg-basil-500' : 'bg-paprika-500'}`} aria-hidden="true" />
            {ep.status != null ? `HTTP ${ep.status}` : 'Unreachable'}
            {ep.ms != null && <span>· {ep.ms}ms</span>}
            <span className="text-pepper-400 dark:text-pepper-500">· {ep.detail}</span>
          </p>
        ) : (
          <p className="text-pepper-400 dark:text-pepper-500">
            {status.note ?? 'No endpoint to ping until required env vars are set.'}
          </p>
        )}
      </div>
    </div>
  );
}

function ConnectionStatusPanel() {
  const { userId } = useStore();
  const [statuses, setStatuses] = useState<IntegrationStatus[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      setLoading(true);
      try {
        const res = await fetchIntegrationStatus(userId);
        if (cancelled) return;
        setStatuses(res.integrations);
        setCheckedAt(res.checkedAt);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to check integrations.');
      } finally {
        if (!cancelled) {
          setLoading(false);
          // Pause polling while the tab is hidden; the visibility listener
          // below reschedules when it becomes visible again.
          if (document.visibilityState === 'visible') timer = setTimeout(run, POLL_MS);
        }
      }
    };
    run();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, POLL_MS);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, refreshKey]);

  const connected = statuses?.filter((s) => s.enabled && (s.endpoint?.ok ?? true)).length ?? 0;

  return (
    <Card className="mb-6">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            Connection status <Activity size={15} className="text-basil-500" aria-hidden="true" />
          </span>
        }
        subtitle={
          checkedAt
            ? `Polls every 30s — which env vars are set and whether each endpoint responds. Last checked ${new Date(checkedAt).toLocaleTimeString()}.`
            : 'Polls every 30s — which env vars are set and whether each endpoint responds.'
        }
        action={
          <div className="flex items-center gap-2">
            <Badge tone="basil">{connected} connected</Badge>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              aria-label="Refresh connection status"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
              Refresh
            </button>
          </div>
        }
      />
      {error && (
        <p className="mb-3 rounded-lg border border-paprika-200 bg-paprika-50 px-3 py-2 text-sm text-paprika-700 dark:border-paprika-800 dark:bg-paprika-950 dark:text-paprika-300" role="alert">
          {error}
        </p>
      )}
      {statuses ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {statuses.map((s) => <StatusCard key={s.id} status={s} />)}
        </div>
      ) : (
        <p className="text-sm text-pepper-500 dark:text-pepper-300">Checking connections…</p>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Setup guide (static)
// ═══════════════════════════════════════════════════════════════════════════

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  tone: string;
  status: 'live' | 'ready' | 'off';
  statusLabel: string;
  env: string;
}

const INTEGRATIONS: Integration[] = [
  {
    id: 'supabase', name: 'Supabase (Tasks + Reminders)', tone: 'bg-basil-500 text-white',
    description: 'Live Tasks and Reminders table: add, edit, and check off items from Today and Tasks with state persisted to Postgres.',
    icon: Database, status: 'off', statusLabel: 'Not configured', env: 'SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY',
  },
  {
    id: 'github', name: 'GitHub (Repositories)', tone: 'bg-pepper-800 text-white',
    description: 'Pulls branches, commits, PRs, issues, and workflow status for your active repositories via the GitHub API.',
    icon: Github, status: 'off', statusLabel: 'Not configured', env: 'GITHUB_TOKEN',
  },
  {
    id: 'vercel', name: 'Vercel (Deployments)', tone: 'bg-pepper-900 text-white',
    description: 'Fetches the latest deployment per project and runs real-time health checks (status code + response time) on every URL.',
    icon: Rocket, status: 'off', statusLabel: 'Not configured', env: 'VERCEL_TOKEN',
  },
  {
    id: 'firebase', name: 'Firebase Auth + Firestore', tone: 'bg-turmeric-500 text-white',
    description: 'Sign-in and per-user project/version data. When configured, the app gates behind a login and syncs to Firestore.',
    icon: HeartPulse, status: 'off', statusLabel: 'Not configured', env: 'NEXT_PUBLIC_FIREBASE_*',
  },
];

export default function IntegrationsPage() {
  const flags = readLiveFlags();
  const firebase = isFirebaseConfigured();

  const items = INTEGRATIONS.map((i) => {
    if (i.id === 'supabase') {
      return { ...i, status: flags.tasks ? 'live' as const : 'ready' as const, statusLabel: flags.tasks ? 'Connected — Tasks + Reminders live' : 'Schema ready' };
    }
    if (i.id === 'github') {
      return { ...i, status: flags.repositories ? 'live' as const : 'ready' as const, statusLabel: flags.repositories ? 'Connected — Repositories live' : 'Ready (add token)' };
    }
    if (i.id === 'vercel') {
      return { ...i, status: flags.deployments ? 'live' as const : 'ready' as const, statusLabel: flags.deployments ? 'Connected — Deployments live' : 'Ready (add token)' };
    }
    return { ...i, status: firebase ? 'live' as const : 'off' as const, statusLabel: firebase ? 'Connected' : 'Not configured' };
  });

  const liveCount = items.filter((i) => i.status === 'live').length;

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Live data sources for the Command Center. Credentials live in environment variables — nothing is stored in the browser."
      />

      <ConnectionStatusPanel />

      <div className="mb-6 flex items-center gap-3 rounded-xl2 border border-butter-200 bg-butter-50 p-4 text-sm dark:border-pepper-700 dark:bg-pepper-800">
        <Plug size={18} className="shrink-0 text-tomato-500" aria-hidden="true" />
        <p className="text-pepper-600 dark:text-pepper-200">
          {liveCount > 0
            ? `${liveCount} integration${liveCount === 1 ? '' : 's'} connected. Today, Tasks, Repositories, and Deployments are pulling live data.`
            : 'No live integrations connected yet — set the env vars below (see .env.example) and redeploy. Until then the app runs on local demo data so every screen stays usable.'}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((integration) => {
          const Icon = integration.icon;
          return (
            <Card key={integration.id}>
              <div className="flex items-start gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl2 ${integration.tone}`}>
                  <Icon size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-base font-bold">{integration.name}</h3>
                    {integration.status === 'live'
                      ? <Badge tone="basil"><Check size={11} aria-hidden="true" /> connected</Badge>
                      : <Badge>{integration.statusLabel}</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-pepper-500 dark:text-pepper-300">{integration.description}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between rounded-lg bg-butter-100 px-3 py-2 text-xs dark:bg-pepper-700">
                <span className="inline-flex items-center gap-1.5 text-pepper-500 dark:text-pepper-300">
                  <Wrench size={12} aria-hidden="true" /> <code className="font-mono">{integration.env}</code>
                </span>
                <a
                  href="https://github.com/LCHEROURI/portfolio-app-freebuff#-live-integrations-supabase-github-vercel"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-tomato-600 hover:underline dark:text-tomato-300"
                >
                  Setup guide <ExternalLink size={11} aria-hidden="true" />
                </a>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6">
        <CardHeader title="Local Repository Scanner" subtitle="The CLI companion reports local git state — uncommitted changes and unpushed commits — which is merged on top of the live GitHub feed." />
        <p className="text-sm text-pepper-600 dark:text-pepper-200">
          Run <code className="rounded bg-butter-100 px-1.5 py-0.5 font-mono text-xs dark:bg-pepper-700">npm run scanner -- --path ~/dev/my-app</code> from a terminal.
          The scanner POSTs metadata to the Command Center API (see the Repositories page).
        </p>
      </Card>
    </div>
  );
}
