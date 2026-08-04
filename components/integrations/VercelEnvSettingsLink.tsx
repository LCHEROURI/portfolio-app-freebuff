'use client';

import { ExternalLink } from 'lucide-react';

// ============================================================================
// Shared "Open Vercel project env settings" deep-link.
// Used by the Integrations setup checklists, the Command Center setup banner,
// and the sidebar connection-status widget so a missing integration is one
// click from Vercel's Environment Variables page anywhere it's surfaced.
// Overridable per deployment via NEXT_PUBLIC_ env vars (e.g. when a fork lives
// under a different team/project); defaults match this repo's own Vercel
// project.
// ============================================================================

const DEFAULT_TEAM_SLUG = 'laredj-chehrouris-projects';
const DEFAULT_PROJECT_SLUG = 'portfolio-app-freebuff';

/**
 * Build the Vercel Environment Variables deep-link from an env-like object.
 * Empty strings and unset keys fall back to this repo's own Vercel project,
 * so the link works out of the box and forks can repoint it via
 * `NEXT_PUBLIC_VERCEL_TEAM_SLUG` / `NEXT_PUBLIC_VERCEL_PROJECT_SLUG`.
 */
export const buildVercelEnvUrl = (env: Record<string, string | undefined> = {}): string =>
  `https://vercel.com/${env.NEXT_PUBLIC_VERCEL_TEAM_SLUG || DEFAULT_TEAM_SLUG}/${
    env.NEXT_PUBLIC_VERCEL_PROJECT_SLUG || DEFAULT_PROJECT_SLUG
  }/settings/environment-variables`;

export const VERCEL_ENV_URL = buildVercelEnvUrl({
  NEXT_PUBLIC_VERCEL_TEAM_SLUG: process.env.NEXT_PUBLIC_VERCEL_TEAM_SLUG,
  NEXT_PUBLIC_VERCEL_PROJECT_SLUG: process.env.NEXT_PUBLIC_VERCEL_PROJECT_SLUG,
});

export function VercelEnvSettingsLink({
  label = 'Open Vercel project env settings',
  className = 'inline-flex items-center gap-1 font-medium text-pepper-500 transition-colors hover:text-tomato-600 dark:text-pepper-300 dark:hover:text-tomato-300',
}: {
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={VERCEL_ENV_URL}
      target="_blank"
      rel="noreferrer"
      className={className}
    >
      {label} <ExternalLink size={11} aria-hidden="true" />
    </a>
  );
}
