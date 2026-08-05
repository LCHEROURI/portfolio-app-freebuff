'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import {
  Activity, Check, ChevronDown, Copy, Cpu, Database, ExternalLink, FlaskConical,
  Github, HeartPulse, Plug, RefreshCw, Rocket, Wrench, X, type LucideIcon,
} from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge, type Tone } from '@/components/ui/Badge';
import { VarCopyButton } from '@/components/integrations/VarCopyButton';
import { VercelEnvSettingsLink } from '@/components/integrations/VercelEnvSettingsLink';
import { firstVarSource, varSourceUrl } from '@/lib/integrationVarLinks';
import { copyToClipboard } from '@/lib/clipboard';
import { isFirebaseConfigured } from '@/lib/firebase';
import { readLiveFlags, type IntegrationStatus } from '@/lib/liveData';
import {
  armStatusSimulation, disarmStatusSimulation, installStatusSimulationFetch,
  isStatusSimulationEnabled,
} from '@/lib/statusSimulation';
import { useStore } from '@/lib/store';
import { useIntegrationStatus } from '@/lib/useIntegrationStatus';
import type { IntegrationChange } from '@/lib/integrationDiff';

// ═══════════════════════════════════════════════════════════════════════════
// Live connection-status panel — polls /api/status every 30s.
// ═══════════════════════════════════════════════════════════════════════════

const POLL_MS = 30_000;

const STATUS_ICONS: Record<string, LucideIcon> = {
  firestore: Database,
  github: Github,
  vercel: Rocket,
  firebase: HeartPulse,
  automation: Cpu,
};

const STATUS_TONES: Record<string, string> = {
  firestore: 'bg-basil-500 text-white',
  github: 'bg-pepper-800 text-white',
  vercel: 'bg-pepper-900 text-white',
  firebase: 'bg-turmeric-500 text-white',
  automation: 'bg-eggplant-700 text-white',
};

// ─── Setup checklist data ────────────────────────────────────────────────────
// The exact .env.example lines per integration (mirrored from the repo's
// .env.example) so a missing integration shows precisely what to paste into
// Vercel → Project → Settings → Environment Variables, then how to redeploy.

interface SetupStep {
  label: string;
  /** Exact .env.example line(s) to paste (placeholders for values). */
  code?: string;
  note?: string;
}

const SETUP_GUIDES: Record<string, SetupStep[]> = {
  firestore: [
    {
      label: 'Create a service account for the automation cron',
      note: 'Console → Project settings → Service accounts → Generate new private key. The service account needs Cloud Datastore / Firestore read access (roles/datastore.user).',
    },
    {
      label: 'Add the service account JSON (server-only)',
      code: 'FIREBASE_SERVICE_ACCOUNT=<service-account-json>',
      note: 'The cron reads projects/versions/tasks/evaluations from Firestore through this account. Never prefix it with NEXT_PUBLIC_.',
    },
  ],
  github: [
    {
      label: 'Create a fine-grained personal access token',
      note: 'GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens, with read access to Contents and Metadata.',
    },
    {
      label: 'Add the token (owner and repo list already default to your active repos)',
      code: 'GITHUB_TOKEN=<github_pat_...>\nGITHUB_OWNER=LCHEROURI\nGITHUB_REPOS=portfolio-app-freebuff,freebuff-meal,newark-websites25,prompt-vault-pro,tip-compass,reviewmaestro-production,mortgage-zip-lead-engine',
    },
    {
      label: 'Turn on the live flag',
      code: 'NEXT_PUBLIC_LIVE_REPOS=1',
    },
  ],
  vercel: [
    {
      label: 'Create a Vercel API token',
      note: 'Vercel → Account Settings → Tokens → Create Token with read access.',
    },
    {
      label: 'Add the token (projects default to GITHUB_REPOS)',
      code: 'VERCEL_TOKEN=<token>\nVERCEL_TEAM_ID=<team-id>\nVERCEL_PROJECTS=',
      note: 'TEAM_ID and PROJECTS are optional — omit them to use your personal account and the GitHub repo list.',
    },
    {
      label: 'Turn on the live flag',
      code: 'NEXT_PUBLIC_LIVE_DEPLOYMENTS=1',
    },
  ],
  firebase: [
    {
      label: 'Register a web app in the Firebase console',
      note: 'Console → Project settings → Your apps → </> Web. Copy the SDK config values below.',
    },
    {
      label: 'Add the client config',
      code: 'NEXT_PUBLIC_FIREBASE_API_KEY=<api-key>\nNEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<auth-domain>\nNEXT_PUBLIC_FIREBASE_PROJECT_ID=<project-id>\nNEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=<bucket>\nNEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<sender-id>\nNEXT_PUBLIC_FIREBASE_APP_ID=<app-id>',
    },
    {
      label: 'Optional: Firebase Hosting deployments feed',
      code: 'FIREBASE_TOKEN=',
      note: 'Generate with npx firebase login:ci. Without it the app still works — only the Hosting deployments feed stays off.',
    },
  ],
  automation: [
    {
      label: 'Create a Resend API key',
      note: 'https://resend.com → API Keys. The free tier covers daily report emails.',
    },
    {
      label: 'Pick a CRON_SECRET and a report inbox',
      code: 'CRON_SECRET=<long-random-string>\nRESEND_API_KEY=<key>\nREPORT_EMAIL=you@example.com',
      note: 'Vercel Cron sends CRON_SECRET automatically as Authorization: Bearer — the route rejects requests without it.',
    },
  ],
};

const REDEPLOY_STEP: SetupStep = {
  label: 'Redeploy to Vercel',
  code: 'git push origin main',
  note: 'Env changes only apply on the next deployment. Pushing triggers a new one automatically (or use Redeploy in the Vercel dashboard).',
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

function StatusCard({ status, change }: { status: IntegrationStatus; change?: IntegrationChange }) {
  const Icon = STATUS_ICONS[status.id] ?? Plug;
  const { tone, label } = stateOf(status);
  const ep = status.endpoint;

  return (
    <div className="relative rounded-xl2 border border-butter-200 bg-butter-50 p-4 dark:border-pepper-700 dark:bg-pepper-800">
      {change && (
        <span className="group absolute -right-1.5 -top-1.5">
          <span
            tabIndex={0}
            aria-label={`Updated — ${change.changes.join(', ')}`}
            className="animate-[badge-pop_0.3s_ease-out] inline-flex cursor-help items-center gap-1 rounded-full border border-turmeric-300 bg-turmeric-100 px-2 py-0.5 text-[10px] font-semibold text-turmeric-700 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-basil-500 dark:border-turmeric-700 dark:bg-turmeric-900/80 dark:text-turmeric-200"
          >
            Updated
          </span>
          {/* What-changed tooltip: appears on hover AND keyboard focus, listing
              the exact fields that flipped since the previous poll. */}
          {/* The badge's aria-label already announces every change, so this
              visual-only tooltip stays aria-hidden to avoid double-reading. */}
          <span
            role="tooltip"
            aria-hidden="true"
            className="pointer-events-none invisible absolute right-0 top-full z-30 mt-1.5 w-max max-w-[240px] rounded-lg border border-butter-200 bg-white p-2 text-left shadow-xl opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 dark:border-pepper-600 dark:bg-pepper-800"
          >
            <span className="block text-[9px] font-semibold uppercase tracking-wide text-pepper-400 dark:text-pepper-500">
              What changed
            </span>
            <ul className="mt-1 space-y-0.5">
              {change.changes.map((c) => (
                <li key={c} className="text-[10px] font-medium text-pepper-700 dark:text-flour-100">
                  {c}
                </li>
              ))}
            </ul>
          </span>
        </span>
      )}
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

      <div className="mt-3 text-xs">
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

      {status.authDomains && (
        <div
          className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
            status.authDomains.ok
              ? 'border-basil-200 bg-basil-50 text-basil-700 dark:border-basil-800 dark:bg-basil-950 dark:text-basil-300'
              : 'border-paprika-200 bg-paprika-50 text-paprika-700 dark:border-paprika-800 dark:bg-paprika-950 dark:text-paprika-300'
          }`}
        >
          <p className="flex items-center gap-1.5 font-semibold">
            {status.authDomains.ok ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
            {status.authDomains.ok ? 'Domain authorized for sign-in' : 'Domain NOT authorized — sign-in is blocked'}
          </p>
          {!status.authDomains.ok && (
            <p className="mt-1 font-medium">
              Add <code className="rounded bg-paprika-100 px-1 py-0.5 font-mono text-[11px] dark:bg-paprika-900">{status.authDomains.origin}</code>{' '}
              under Firebase → Authentication → Authorized domains, then Save (no redeploy needed).{' '}
              <a
                href={status.authDomains.href}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-tomato-600 underline underline-offset-2 hover:text-tomato-700 dark:text-tomato-300"
              >
                Open console ↗
              </a>
            </p>
          )}
        </div>
      )}

      <SetupChecklist status={status} />
    </div>
  );
}

// ─── Setup checklist ─────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    if (await copyToClipboard(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <button
      type="button"
      onClick={handle}
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-pepper-400 transition-colors hover:bg-butter-100 hover:text-pepper-700 dark:text-pepper-400 dark:hover:bg-pepper-700 dark:hover:text-flour-100"
    >
      {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    if (await copyToClipboard(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className="relative mt-1.5 overflow-hidden rounded-lg bg-pepper-900 dark:bg-pepper-950">
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all px-3 py-2 pr-20 font-mono text-[11px] leading-relaxed text-flour-100">
        {code}
      </pre>
      <button
        type="button"
        onClick={handle}
        aria-label={copied ? 'Copied' : 'Copy env lines'}
        className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-pepper-800 px-1.5 py-1 text-[10px] font-semibold text-flour-200 transition-colors hover:bg-pepper-700 dark:text-flour-100"
      >
        {copied ? <Check size={10} aria-hidden="true" /> : <Copy size={10} aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/**
 * Inline setup checklist: when required env vars are missing, shows the exact
 * .env.example lines to paste plus the redeploy step. When everything is set,
 * confirms it (and nudges to flip the live flag if it's still off).
 */
function SetupChecklist({ status }: { status: IntegrationStatus }) {
  const missing = status.env.filter((v) => !v.set && v.required);
  const [open, setOpen] = useState(missing.length > 0);

  const flagOff = status.env.find((v) => v.name.startsWith('NEXT_PUBLIC_LIVE_') && !v.set);
  // When credentials are missing, deep-link to the page where the token/key
  // is created; flag-only gaps stay on the Vercel env page (labeled with the
  // exact flag — Vercel's env UI has no per-row URL anchors).
  const credentialsMissing = missing.some((v) => !v.name.startsWith('NEXT_PUBLIC_LIVE_'));
  // The footer "get the token" link only earns its spot when some missing var
  // has no per-var deep-link of its own (e.g. Automation's CRON_SECRET /
  // REPORT_EMAIL) — otherwise the per-var links above already cover the gap.
  // The anchor is derived from the same per-var map as the deep-links
  // (firstVarSource), so the two URL sets can never drift out of sync.
  const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const footerTokenLink =
    credentialsMissing && missing.some((v) => varSourceUrl(v.name, firebaseProjectId) === null)
      ? firstVarSource(missing.map((v) => v.name), firebaseProjectId)
      : null;
  const envLinkLabel = credentialsMissing
    ? 'Paste in Vercel env settings'
    : flagOff
      ? `Flip ${flagOff.name}=1 in Vercel env settings`
      : 'Open Vercel project env settings';

  let body: ReactNode;
  if (missing.length === 0) {
    body = flagOff ? (
      <p className="text-xs text-turmeric-700 dark:text-turmeric-300">
        Required vars are set — flip{' '}
        <code className="rounded bg-butter-100 px-1 py-0.5 font-mono dark:bg-pepper-700">{flagOff.name}=1</code>{' '}
        to activate this integration.
      </p>
    ) : (
      <p className="text-xs font-medium text-basil-700 dark:text-basil-300">
        <Check size={12} className="mr-1 inline" aria-hidden="true" /> All required env vars are set
      </p>
    );
  } else {
    const guide = SETUP_GUIDES[status.id] ?? [];
    const steps = [...guide, REDEPLOY_STEP];
    // Copy-all carries only the env lines — the redeploy `git push` step is
    // intentionally excluded so the blob is safe to paste into Vercel's env UI.
    const allLines = guide.flatMap((s) => (s.code ? [s.code] : [])).join('\n');
    body = (
      <>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`${status.id}-checklist`}
          className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-turmeric-700 dark:text-turmeric-300"
        >
          <span className="inline-flex items-center gap-1.5">
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            Setup checklist · {missing.length} missing required {missing.length === 1 ? 'var' : 'vars'}
          </span>
          <span className="font-normal text-pepper-400 dark:text-pepper-500">{open ? 'Hide steps' : 'Show steps'}</span>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-[22px] font-mono text-[10px] text-paprika-600 dark:text-paprika-400">
          {missing.map((v, i) => {
            // Per-var deep-link to where this var's value lives (GitHub token
            // page, Firebase console project, …). Vars you invent yourself
            // (CRON_SECRET, REPORT_EMAIL) render plain.
            const src = varSourceUrl(v.name, firebaseProjectId);
            return (
              <Fragment key={v.name}>
                {i > 0 && <span aria-hidden="true">·</span>}
                {src ? (
                  <span className="inline-flex items-center gap-0.5">
                    <a
                      href={src.href}
                      target="_blank"
                      rel="noreferrer"
                      title={`Get ${v.name} — ${src.label}`}
                      aria-label={`Get ${v.name} — ${src.label}`}
                      className="font-medium text-tomato-600 hover:underline dark:text-tomato-300"
                    >
                      {v.name} <ExternalLink size={9} aria-hidden="true" />
                    </a>
                    <VarCopyButton name={v.name} />
                  </span>
                ) : (
                  <span>{v.name}</span>
                )}
              </Fragment>
            );
          })}
        </div>

        {open && (
          <ol id={`${status.id}-checklist`} className="mt-3 space-y-3">
            {steps.map((step, i) => (
              <li key={`${status.id}-step-${i}`} className="flex gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-turmeric-100 text-[11px] font-bold text-turmeric-800 dark:bg-turmeric-900 dark:text-turmeric-200">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-pepper-800 dark:text-flour-100">{step.label}</p>
                  {step.note && <p className="mt-0.5 text-[11px] leading-snug text-pepper-400 dark:text-pepper-400">{step.note}</p>}
                  {step.code && <CodeBlock code={step.code} />}
                </div>
              </li>
            ))}
            <li className="flex items-center justify-between rounded-lg bg-butter-100 py-1.5 pl-3 pr-1.5 dark:bg-pepper-700">
              <span className="text-[11px] text-pepper-500 dark:text-pepper-300">Copy every env line above</span>
              <CopyButton text={allLines} />
            </li>
          </ol>
        )}
      </>
    );
  }

  return (
    <div className="mt-3 border-t border-butter-200 pt-2 dark:border-pepper-700">
      {body}
      <div className="mt-2.5 flex flex-col items-end gap-1.5">
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {footerTokenLink && (
            <a
              href={footerTokenLink.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-tomato-600 hover:underline dark:text-tomato-300"
            >
              {footerTokenLink.label} <ExternalLink size={11} aria-hidden="true" />
            </a>
          )}
          <VercelEnvSettingsLink label={envLinkLabel} />
        </div>
        {(missing.length > 0 || flagOff) && (
          <p className="text-[10px] text-pepper-400 dark:text-pepper-500">
            After making changes, come back — the panel refreshes when this tab regains focus.
          </p>
        )}
      </div>
    </div>
  );
}

function ConnectionStatusPanel() {
  const { userId } = useStore();
  // Shared hook — same polling/refresh behavior as the sidebar widget, with
  // the server-side ping cache absorbing provider API calls between polls.
  const { statuses, checkedAt, error, loading, changed, refresh } = useIntegrationStatus(userId, POLL_MS);

  // Dev-only status-flip simulator: when NEXT_PUBLIC_ENABLE_SIMULATIONS=1,
  // wrap the global fetch so armed polls report GitHub as down. This lets the
  // what-changed badge + tooltip be demonstrated without a real outage.
  const simulationEnabled = isStatusSimulationEnabled();
  const [simArmed, setSimArmed] = useState(false);
  useEffect(() => {
    if (!simulationEnabled) return;
    const origFetch = window.fetch.bind(window);
    const wrapped = installStatusSimulationFetch(origFetch);
    window.fetch = wrapped;
    return () => {
      // Only restore the one wrapper this page installed.
      if (window.fetch === wrapped) window.fetch = origFetch;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationEnabled]);

  const toggleSimulation = () => {
    const next = !simArmed;
    setSimArmed(next);
    if (next) armStatusSimulation(); else disarmStatusSimulation();
    refresh(); // force a poll so the flip lands immediately
  };

  const connected = statuses?.filter((s) => s.enabled && (s.endpoint?.ok ?? true)).length ?? 0;
  const changedSummary = changed.length > 0
    ? ` ${changed.length} card${changed.length === 1 ? '' : 's'} just updated.`
    : '';

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
            ? `Polls every 30s — which env vars are set and whether each endpoint responds. Cards show “Updated” when a check detects a change. Last checked ${new Date(checkedAt).toLocaleTimeString()}.`
            : 'Polls every 30s — which env vars are set and whether each endpoint responds. Cards show “Updated” when a check detects a change.'
        }
        action={
          <div className="flex items-center gap-2">
            <Badge tone="basil">{connected} connected</Badge>
            {simulationEnabled && (
              <button
                type="button"
                onClick={toggleSimulation}
                aria-pressed={simArmed}
                aria-label={simArmed ? 'Stop simulated outage' : 'Simulate a status flip'}
                title={simArmed ? 'Restore real status — the badge will flip back' : 'Report GitHub as down so the Updated badge + tooltip appear'}
                className="btn-ghost text-xs"
              >
                <FlaskConical size={13} className={simArmed ? 'text-paprika-500' : ''} aria-hidden="true" />
                {simArmed ? 'Stop simulated outage' : 'Simulate status flip'}
              </button>
            )}
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={refresh}
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
        <>
          {changedSummary && (
            <p className="mb-3 text-xs font-medium text-turmeric-700 dark:text-turmeric-300" role="status">
              {changedSummary}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {statuses.map((s) => (
              <StatusCard
                key={s.id}
                status={s}
                change={changed.find((c) => c.id === s.id)}
              />
            ))}
          </div>
        </>
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
    id: 'firestore', name: 'Firestore (data store)', tone: 'bg-basil-500 text-white',
    description: 'Projects, versions, evaluations, tasks, and activity all persist to Firestore through the Firebase SDK — the app\'s single data store, no separate database to provision.',
    icon: Database, status: 'off', statusLabel: 'Not configured', env: 'FIREBASE_SERVICE_ACCOUNT',
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
    if (i.id === 'firestore') {
      return { ...i, status: firebase ? 'live' as const : 'off' as const, statusLabel: firebase ? 'Connected — Firestore store active' : 'Not configured' };
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
                <span className="flex items-center gap-3">
                  <a
                    href="https://github.com/LCHEROURI/portfolio-app-freebuff#-live-integrations-github-vercel-firebase"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-tomato-600 hover:underline dark:text-tomato-300"
                  >
                    Setup guide <ExternalLink size={11} aria-hidden="true" />
                  </a>
                  <VercelEnvSettingsLink label="Env settings" />
                </span>
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
