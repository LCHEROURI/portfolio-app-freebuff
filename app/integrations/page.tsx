'use client';

import { Github, Rocket, Database, HeartPulse, Plug, ExternalLink, Check, Wrench } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { isFirebaseConfigured } from '@/lib/firebase';
import { readLiveFlags } from '@/lib/liveData';

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: typeof Github;
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
