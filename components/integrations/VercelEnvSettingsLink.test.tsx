import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildVercelEnvUrl } from './VercelEnvSettingsLink';

const DEFAULT_URL =
  'https://vercel.com/laredj-chehrouris-projects/portfolio-app-freebuff/settings/environment-variables';

// VERCEL_ENV_URL is computed once at module import, so env overrides must be
// applied BEFORE the module is (re)loaded. Every render test loads the module
// fresh with stubbed process.env so results never depend on the runner's
// ambient shell environment (which could otherwise leak NEXT_PUBLIC_VERCEL_*
// values and break the fallback assertions).
const loadWithEnv = async (env: Record<string, string | undefined> = {}) => {
  vi.stubEnv('NEXT_PUBLIC_VERCEL_TEAM_SLUG', env.NEXT_PUBLIC_VERCEL_TEAM_SLUG);
  vi.stubEnv('NEXT_PUBLIC_VERCEL_PROJECT_SLUG', env.NEXT_PUBLIC_VERCEL_PROJECT_SLUG);
  vi.resetModules();
  return import('./VercelEnvSettingsLink');
};

describe('buildVercelEnvUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls back to the repo defaults when the override env vars are unset', () => {
    expect(buildVercelEnvUrl({})).toBe(DEFAULT_URL);
    expect(buildVercelEnvUrl()).toBe(DEFAULT_URL);
  });

  it('falls back to the repo defaults when the override env vars are empty strings', () => {
    expect(buildVercelEnvUrl({ NEXT_PUBLIC_VERCEL_TEAM_SLUG: '', NEXT_PUBLIC_VERCEL_PROJECT_SLUG: '' })).toBe(
      DEFAULT_URL,
    );
  });

  it('uses NEXT_PUBLIC_VERCEL_TEAM_SLUG / PROJECT_SLUG when set', () => {
    const url = buildVercelEnvUrl({
      NEXT_PUBLIC_VERCEL_TEAM_SLUG: 'acme-team',
      NEXT_PUBLIC_VERCEL_PROJECT_SLUG: 'acme-app',
    });
    expect(url).toBe('https://vercel.com/acme-team/acme-app/settings/environment-variables');
  });

  it('falls back per-var when only one override is set', () => {
    const url = buildVercelEnvUrl({ NEXT_PUBLIC_VERCEL_TEAM_SLUG: 'fork-team' });
    expect(url).toBe('https://vercel.com/fork-team/portfolio-app-freebuff/settings/environment-variables');
  });
});

describe('VercelEnvSettingsLink', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders an anchor to the default env-settings URL when overrides are unset', async () => {
    const { VercelEnvSettingsLink } = await loadWithEnv();
    render(<VercelEnvSettingsLink />);
    const link = screen.getByRole('link', { name: /open vercel project env settings/i });
    expect(link).toHaveAttribute('href', DEFAULT_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('renders a custom label', async () => {
    const { VercelEnvSettingsLink } = await loadWithEnv();
    render(<VercelEnvSettingsLink label="Env settings" />);
    expect(screen.getByRole('link', { name: 'Env settings' })).toHaveAttribute('href', DEFAULT_URL);
  });

  it('href honors NEXT_PUBLIC_VERCEL_TEAM_SLUG / PROJECT_SLUG overrides', async () => {
    const { VercelEnvSettingsLink } = await loadWithEnv({
      NEXT_PUBLIC_VERCEL_TEAM_SLUG: 'acme-team',
      NEXT_PUBLIC_VERCEL_PROJECT_SLUG: 'acme-app',
    });
    render(<VercelEnvSettingsLink />);
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://vercel.com/acme-team/acme-app/settings/environment-variables',
    );
  });

  it('href falls back to the repo defaults when overrides are empty', async () => {
    const { VercelEnvSettingsLink } = await loadWithEnv({
      NEXT_PUBLIC_VERCEL_TEAM_SLUG: '',
      NEXT_PUBLIC_VERCEL_PROJECT_SLUG: '',
    });
    render(<VercelEnvSettingsLink />);
    expect(screen.getByRole('link')).toHaveAttribute('href', DEFAULT_URL);
  });

  it('module-level VERCEL_ENV_URL matches the env the module was loaded with', async () => {
    const { VERCEL_ENV_URL } = await loadWithEnv();
    expect(VERCEL_ENV_URL).toBe(DEFAULT_URL);
  });
});
