'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';

import { VarCopyButton } from '@/components/integrations/VarCopyButton';
import { VERCEL_ENV_URL, VercelEnvSettingsLink } from '@/components/integrations/VercelEnvSettingsLink';
import { varSourceUrl } from '@/lib/integrationVarLinks';
import type { IntegrationStatus } from '@/lib/liveData';
import { useStore } from '@/lib/store';
import { useIntegrationStatus } from '@/lib/useIntegrationStatus';

// ============================================================================
// Sidebar connection-status widget.
// Uses the shared useIntegrationStatus hook (server-cached pings, so polling
// never re-hits provider APIs) and renders one colored dot per integration.
// Clicking navigates to the Integrations page — and closes the mobile drawer.
// ============================================================================

const POLL_MS = 60_000;

type Level = 'ok' | 'warn' | 'err' | 'off';

const levelOf = (s: IntegrationStatus): Level => {
  if (!s.configured) return 'off';
  if (s.endpoint) return s.endpoint.ok ? 'ok' : 'err';
  return s.enabled ? 'ok' : 'warn';
};

const DOT_TONES: Record<Level, string> = {
  ok: 'bg-basil-500',
  err: 'bg-paprika-500',
  warn: 'bg-turmeric-500',
  off: 'bg-pepper-300 dark:bg-pepper-600',
};

const labelOf = (s: IntegrationStatus): string => {
  switch (levelOf(s)) {
    case 'err': return `Endpoint error — ${s.endpoint?.detail ?? 'unreachable'}`;
    case 'ok': return s.endpoint ? 'Responding' : 'Connected';
    case 'warn': return 'Configured · flag off';
    default: return 'Not configured';
  }
};

export const ConnectionStatusWidget = ({ onClose }: { onClose?: () => void }) => {
  const { userId } = useStore();
  const { statuses, error } = useIntegrationStatus(userId, POLL_MS);
  const failed = error !== null;

  const summary = (): { text: string; dot: string } => {
    if (!statuses) {
      return failed
        ? { text: 'Status unavailable', dot: DOT_TONES.err }
        : { text: 'Checking…', dot: 'bg-pepper-300 animate-pulse' };
    }
    const counts: Record<Level, number> = { ok: 0, warn: 0, err: 0, off: 0 };
    for (const s of statuses) counts[levelOf(s)] += 1;
    if (counts.err > 0) {
      return { text: `${counts.err} issue${counts.err === 1 ? '' : 's'}`, dot: DOT_TONES.err };
    }
    if (counts.ok > 0) return { text: `${counts.ok}/${statuses.length} connected`, dot: DOT_TONES.ok };
    if (counts.warn > 0) return { text: 'Configured', dot: DOT_TONES.warn };
    return { text: 'Local workspace', dot: DOT_TONES.off };
  };

  const { text, dot } = summary();

  // One-click env-settings deep-link appears when any integration isn't fully
  // healthy (off / configured-flag-off / endpoint error), so the setup path is
  // reachable from any page — not just the Integrations page.
  const needsSetup = statuses ? statuses.some((s) => levelOf(s) !== 'ok') : false;

  // Per-var console links + copy affordances: every missing required env var
  // deep-links to where its value lives (GitHub token page, Supabase API
  // settings, Firebase console) with a one-click copy of the .env.example
  // line — same affordances as the Integrations setup checklists, now reachable
  // from any page without leaving the sidebar.
  const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const missingVars = statuses
    ? statuses.flatMap((s) =>
        s.env
          .filter((v) => !v.set && v.required)
          .map((v) => ({ integrationId: s.id, integrationName: s.name, name: v.name })),
      )
    : [];

  // Tooltip for the main row: per-integration status, plus — when nothing is
  // connected (empty/off state) — the exact env-settings URL so the setup
  // path is discoverable even before the inline link row renders meaningfully.
  const tooltip = statuses
    ? statuses.map((s) => `${s.name}: ${labelOf(s)}`).join(' · ')
    : text;
  const allOff = statuses ? statuses.every((s) => levelOf(s) === 'off') : false;
  const linkTitle = `${tooltip}${allOff ? ` · Set up at ${VERCEL_ENV_URL}` : ''}`;

  return (
    <div className="rounded-lg bg-butter-100 px-3 py-2 text-xs transition-colors hover:bg-butter-200 dark:bg-pepper-700 dark:hover:bg-pepper-600">
      <Link
        href="/integrations"
        onClick={onClose}
        aria-label={`Integration status — ${text}`}
        title={linkTitle}
        className="block transition-colors hover:text-tomato-600 dark:hover:text-tomato-300"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-pepper-600 dark:text-pepper-200">
            <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
            <span className="truncate font-semibold">{text}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
            {statuses ? (
              statuses.map((s) => (
                <span
                  key={s.id}
                  title={`${s.name} — ${labelOf(s)}`}
                  className={`h-2 w-2 rounded-full ${DOT_TONES[levelOf(s)]}`}
                />
              ))
            ) : (
              <span className="h-2 w-2 animate-pulse rounded-full bg-pepper-300 dark:bg-pepper-600" />
            )}
          </span>
        </div>
        {failed && statuses && (
          <p className="mt-1 text-paprika-600 dark:text-paprika-300">Rechecking…</p>
        )}
      </Link>
      {needsSetup && (
        <div className="mt-1.5 space-y-1 border-t border-butter-200 pt-1.5 dark:border-pepper-600">
          {missingVars.length > 0 && (
            <ul className="space-y-1">
              {missingVars.map(({ integrationId, integrationName, name }) => {
                const src = varSourceUrl(name, firebaseProjectId);
                return (
                  <li
                    key={`${integrationId}:${name}`}
                    className="flex items-center justify-between gap-1"
                  >
                    <span className="flex min-w-0 items-center gap-1">
                      <span
                        className="shrink-0 truncate text-[9px] uppercase tracking-wide text-pepper-400 dark:text-pepper-500"
                        title={integrationName}
                      >
                        {integrationName}
                      </span>
                      {src ? (
                        <a
                          href={src.href}
                          target="_blank"
                          rel="noreferrer"
                          title={`Get ${name} — ${src.label}`}
                          aria-label={`Get ${name} — ${src.label}`}
                          className="inline-flex min-w-0 items-center gap-0.5 font-mono font-medium text-tomato-600 hover:underline dark:text-tomato-300"
                        >
                          <span className="truncate">{name}</span>
                          <ExternalLink size={9} aria-hidden="true" />
                        </a>
                      ) : (
                        <span className="truncate font-mono text-pepper-500 dark:text-pepper-300">{name}</span>
                      )}
                    </span>
                    <VarCopyButton name={name} />
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex items-center justify-end">
            <VercelEnvSettingsLink
              label="Env settings"
              className="inline-flex items-center gap-1 text-[10px] font-medium text-pepper-500 transition-colors hover:text-tomato-600 dark:text-pepper-300 dark:hover:text-tomato-300"
            />
          </div>
        </div>
      )}
    </div>
  );
};
