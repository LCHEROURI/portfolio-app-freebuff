'use client';

import { useState } from 'react';
import { Github, Rocket, Calendar, Sparkles, Plug, ExternalLink, Check } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Field';
import { isFirebaseConfigured } from '@/lib/firebase';

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: typeof Github;
  tone: string;
  connected: boolean;
  fields: { key: string; label: string; placeholder: string; secret?: boolean }[];
}

const INTEGRATIONS: Integration[] = [
  {
    id: 'github', name: 'GitHub', tone: 'bg-pepper-800 text-white',
    description: 'Sync repository metadata, commits, PRs, and issues for every tracked version.',
    icon: Github, connected: false,
    fields: [{ key: 'token', label: 'Personal access token', placeholder: 'ghp_…', secret: true }],
  },
  {
    id: 'vercel', name: 'Vercel', tone: 'bg-pepper-900 text-white',
    description: 'Pull deployment status and health for production, staging, and preview environments.',
    icon: Rocket, connected: false,
    fields: [{ key: 'token', label: 'Vercel API token', placeholder: '…', secret: true }],
  },
  {
    id: 'calendar', name: 'Google Calendar', tone: 'bg-basil-500 text-white',
    description: 'Create daily report reminders and task due-date events automatically.',
    icon: Calendar, connected: false,
    fields: [{ key: 'calendarId', label: 'Calendar ID', placeholder: 'primary' }],
  },
  {
    id: 'gemini', name: 'Gemini AI Summaries', tone: 'bg-blue-500 text-white',
    description: 'Enrich reports with AI-generated executive summaries and winner recommendations.',
    icon: Sparkles, connected: false,
    fields: [{ key: 'apiKey', label: 'Gemini API key', placeholder: 'AIza…', secret: true }],
  },
];

export default function IntegrationsPage() {
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});

  const toggle = (id: string) => {
    setConnected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connect the platforms your builds run on. Credentials are stored per-user and never shared."
      />

      <div className="mb-6 flex items-center gap-3 rounded-xl2 border border-butter-200 bg-butter-50 p-4 text-sm dark:border-pepper-700 dark:bg-pepper-800">
        <Plug size={18} className="shrink-0 text-tomato-500" aria-hidden="true" />
        <p className="text-pepper-600 dark:text-pepper-200">
          {isFirebaseConfigured()
            ? 'Firebase is configured — integrations persist per user in Firestore.'
            : 'Demo mode — integrations are simulated locally. Add Firebase env vars to persist real credentials.'}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {INTEGRATIONS.map((integration) => {
          const Icon = integration.icon;
          const isOn = connected[integration.id] ?? false;
          return (
            <Card key={integration.id}>
              <div className="flex items-start gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl2 ${integration.tone}`}>
                  <Icon size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-base font-bold">{integration.name}</h3>
                    {isOn ? <Badge tone="basil"><Check size={11} aria-hidden="true" /> connected</Badge> : <Badge>disconnected</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-pepper-500 dark:text-pepper-300">{integration.description}</p>
                </div>
              </div>

              {isOn && (
                <div className="mt-4 space-y-3">
                  {integration.fields.map((field) => (
                    <label key={field.key} className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-pepper-500 dark:text-pepper-300">{field.label}</span>
                      <Input
                        type={field.secret ? 'password' : 'text'}
                        placeholder={field.placeholder}
                        value={values[integration.id]?.[field.key] ?? ''}
                        onChange={(e) => setValues((prev) => ({ ...prev, [integration.id]: { ...prev[integration.id], [field.key]: e.target.value } }))}
                      />
                    </label>
                  ))}
                  <p className="text-xs text-pepper-400">
                    {integration.id === 'github' && 'Used by the repo scanner companion and rule 12 (token expiry).'}
                    {integration.id === 'vercel' && 'Used by deployment health checks and rule 4/11.'}
                    {integration.id === 'calendar' && 'Writes report reminders to your calendar.'}
                    {integration.id === 'gemini' && 'Used by scheduled reports for AI summaries.'}
                  </p>
                </div>
              )}

              <div className="mt-4 flex items-center justify-between border-t border-butter-200 pt-3 dark:border-pepper-700">
                <button type="button" className={isOn ? 'btn-danger' : 'btn-primary'} onClick={() => toggle(integration.id)}>
                  {isOn ? 'Disconnect' : 'Connect'}
                </button>
                <a href="#" onClick={(e) => e.preventDefault()} className="inline-flex items-center gap-1 text-xs text-pepper-400 hover:text-tomato-600">
                  Docs <ExternalLink size={11} aria-hidden="true" />
                </a>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6">
        <CardHeader title="Local Repository Scanner" subtitle="The CLI companion needs no cloud credentials to report git metadata." />
        <p className="text-sm text-pepper-600 dark:text-pepper-200">
          Run <code className="rounded bg-butter-100 px-1.5 py-0.5 font-mono text-xs dark:bg-pepper-700">npm run scanner -- --path ~/dev/my-app</code> from a terminal.
          The scanner POSTs metadata to the Command Center API (see the Repositories page).
        </p>
      </Card>
    </div>
  );
}
