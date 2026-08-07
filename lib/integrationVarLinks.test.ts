import { describe, it, expect } from 'vitest';

import { firebaseConsoleUrl, firstVarSource, varEnvLine, varSourceUrl } from './integrationVarLinks';

// ─── varSourceUrl ───────────────────────────────────────────────────────────

describe('varSourceUrl', () => {
  it('maps GITHUB_TOKEN to the fine-grained token page', () => {
    expect(varSourceUrl('GITHUB_TOKEN')).toEqual({
      label: 'GitHub token page',
      href: 'https://github.com/settings/personal-access-tokens/new',
    });
  });

  it('maps removed vars (Supabase + Resend email) to null and Firebase client vars to the console', () => {
    // SUPABASE vars were removed with the Supabase migration, and Resend vars
    // were removed when emailed report delivery was cut — none of them may
    // resolve to a source page anymore.
    expect(varSourceUrl('SUPABASE_URL')).toBeNull();
    expect(varSourceUrl('SUPABASE_SERVICE_ROLE_KEY')).toBeNull();
    expect(varSourceUrl('RESEND_API_KEY')).toBeNull();
    expect(varSourceUrl('REPORT_FROM')).toBeNull();
  });

  it('maps VERCEL_TOKEN to the account tokens page', () => {
    expect(varSourceUrl('VERCEL_TOKEN')).toEqual({
      label: 'Vercel token page',
      href: 'https://vercel.com/account/tokens',
    });
  });

  it('deep-links Firebase client vars to the exact project when the id is known', () => {
    const expected = {
      label: 'Firebase console',
      href: 'https://console.firebase.google.com/project/apcc-prod/settings/general',
    };
    expect(varSourceUrl('NEXT_PUBLIC_FIREBASE_API_KEY', 'apcc-prod')).toEqual(expected);
    expect(varSourceUrl('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'apcc-prod')).toEqual(expected);
    expect(varSourceUrl('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'apcc-prod')).toEqual(expected);
  });

  it('falls back to the Firebase console root when the project id is unknown', () => {
    expect(varSourceUrl('NEXT_PUBLIC_FIREBASE_API_KEY')).toEqual({
      label: 'Firebase console',
      href: 'https://console.firebase.google.com',
    });
    expect(varSourceUrl('NEXT_PUBLIC_FIREBASE_API_KEY', undefined)).toEqual({
      label: 'Firebase console',
      href: 'https://console.firebase.google.com',
    });
  });

  it('returns null for values you invent yourself (no source page)', () => {
    expect(varSourceUrl('CRON_SECRET')).toBeNull();
    expect(varSourceUrl('REPORT_EMAIL')).toBeNull();
    expect(varSourceUrl('GITHUB_OWNER')).toBeNull();
    expect(varSourceUrl('GITHUB_REPOS')).toBeNull();
    expect(varSourceUrl('NEXT_PUBLIC_LIVE_REPOS')).toBeNull();
    expect(varSourceUrl('UNKNOWN_VAR')).toBeNull();
  });

  it('is case-sensitive (matches exact env var names)', () => {
    expect(varSourceUrl('github_token')).toBeNull();
  });
});

// ─── varEnvLine ─────────────────────────────────────────────────────────────

describe('varEnvLine', () => {
  it('returns the .env.example template line for vars with a source page', () => {
    expect(varEnvLine('GITHUB_TOKEN')).toBe('GITHUB_TOKEN=<github_pat_...>');
    expect(varEnvLine('VERCEL_TOKEN')).toBe('VERCEL_TOKEN=<token>');
    expect(varEnvLine('NEXT_PUBLIC_FIREBASE_API_KEY')).toBe('NEXT_PUBLIC_FIREBASE_API_KEY=<api-key>');
    expect(varEnvLine('NEXT_PUBLIC_FIREBASE_PROJECT_ID')).toBe('NEXT_PUBLIC_FIREBASE_PROJECT_ID=<project-id>');
  });

  it('returns null for removed vars and values you invent yourself (no template line)', () => {
    expect(varEnvLine('RESEND_API_KEY')).toBeNull();
    expect(varEnvLine('CRON_SECRET')).toBeNull();
    expect(varEnvLine('REPORT_EMAIL')).toBeNull();
    expect(varEnvLine('GITHUB_OWNER')).toBeNull();
    expect(varEnvLine('GITHUB_REPOS')).toBeNull();
    expect(varEnvLine('NEXT_PUBLIC_LIVE_REPOS')).toBeNull();
    expect(varEnvLine('UNKNOWN_VAR')).toBeNull();
  });
});

// ─── firstVarSource ─────────────────────────────────────────────────────────

describe('firstVarSource', () => {
  it('returns the source page of the first var that has one', () => {
    expect(firstVarSource(['GITHUB_TOKEN', 'VERCEL_TOKEN'])).toEqual({
      label: 'GitHub token page',
      href: 'https://github.com/settings/personal-access-tokens/new',
    });
  });

  it('skips vars without a source page and falls through to the next', () => {
    // Resend vars are removed; only GITHUB_TOKEN resolves here.
    expect(firstVarSource(['CRON_SECRET', 'REPORT_EMAIL', 'GITHUB_TOKEN'])).toEqual({
      label: 'GitHub token page',
      href: 'https://github.com/settings/personal-access-tokens/new',
    });
  });

  it('returns null when no var has a source page', () => {
    expect(firstVarSource(['CRON_SECRET', 'REPORT_EMAIL', 'RESEND_API_KEY'])).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(firstVarSource([])).toBeNull();
  });

  it('propagates the firebase project id to firebase vars', () => {
    expect(firstVarSource(['NEXT_PUBLIC_FIREBASE_API_KEY', 'VERCEL_TOKEN'], 'apcc-prod')).toEqual({
      label: 'Firebase console',
      href: 'https://console.firebase.google.com/project/apcc-prod/settings/general',
    });
  });
});

// ─── firebaseConsoleUrl ─────────────────────────────────────────────────────

describe('firebaseConsoleUrl', () => {
  it('builds the project settings URL when a project id is given', () => {
    expect(firebaseConsoleUrl('meal-planner')).toEqual({
      label: 'Firebase console',
      href: 'https://console.firebase.google.com/project/meal-planner/settings/general',
    });
  });

  it('falls back to the console root when no project id is given', () => {
    expect(firebaseConsoleUrl()).toEqual({
      label: 'Firebase console',
      href: 'https://console.firebase.google.com',
    });
  });
});
