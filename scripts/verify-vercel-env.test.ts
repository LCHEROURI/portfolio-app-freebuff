import { describe, expect, it } from 'vitest';
import {
  classifyGithubSecrets,
  diffEnvMaps,
  EXPECTED_LIVE_FLAGS,
  missingExpectedFlags,
  parseEnvFile,
  parseGhSecretList,
} from './verify-vercel-env.mjs';

// ── parseEnvFile ────────────────────────────────────────────────────────────
describe('parseEnvFile', () => {
  it('parses KEY=value lines, skipping blanks and # comments', () => {
    const env = parseEnvFile('A=1\n# comment\n\nB=two words\n');
    expect(env.get('A')).toBe('1');
    expect(env.get('B')).toBe('two words');
    expect(env.size).toBe(2);
  });

  it('strips one level of surrounding quotes', () => {
    const env = parseEnvFile('A="quoted"\nB=\'single\'\nC="has = sign"\n');
    expect(env.get('A')).toBe('quoted');
    expect(env.get('B')).toBe('single');
    expect(env.get('C')).toBe('has = sign');
  });

  it('handles CRLF line endings and empty input', () => {
    expect(parseEnvFile('A=1\r\nB=2\r\n').get('A')).toBe('1');
    expect(parseEnvFile('').size).toBe(0);
    expect(parseEnvFile(null).size).toBe(0);
  });
});

// ── diffEnvMaps ─────────────────────────────────────────────────────────────
describe('diffEnvMaps', () => {
  const local = parseEnvFile('SHARED=same\nDRIFTED=local-value\nMISSING=here\n');
  const vercel = parseEnvFile('SHARED=same\nDRIFTED=prod-value\nEXTRA=prod-only\n');

  it('flags a key missing in Vercel', () => {
    const drift = diffEnvMaps(local, vercel);
    expect(drift.missingInVercel).toEqual(['MISSING']);
  });

  it('flags value drift with lengths only (never the values)', () => {
    const drift = diffEnvMaps(local, vercel);
    expect(drift.valueMismatch).toEqual([
      { key: 'DRIFTED', localLen: 'local-value'.length, vercelLen: 'prod-value'.length },
    ]);
    // The report must not leak either value.
    expect(JSON.stringify(drift)).not.toContain('local-value');
    expect(JSON.stringify(drift)).not.toContain('prod-value');
  });

  it('reports Vercel-only extras as informational (not failure items)', () => {
    const drift = diffEnvMaps(local, vercel);
    expect(drift.extraInVercel).toEqual(['EXTRA']);
    expect(drift.missingInVercel).not.toContain('EXTRA');
  });

  it('returns an empty report for identical maps', () => {
    const a = parseEnvFile('A=1\nB=2\n');
    const drift = diffEnvMaps(a, parseEnvFile('A=1\nB=2\n'));
    expect(drift.missingInVercel).toEqual([]);
    expect(drift.valueMismatch).toEqual([]);
    expect(drift.valueUnreadable).toEqual([]);
    expect(drift.extraInVercel).toEqual([]);
  });

  it('presence-checks write-only sensitive vars (empty pull is NOT drift)', () => {
    // Vercel's `sensitive` type cannot be echoed back after creation, so
    // `env pull` returns an empty string for them. A key that EXISTS in Vercel
    // with an empty pulled value must be reported as present-but-unreadable,
    // never as a value mismatch — otherwise the gate false-alarms on every
    // secret (CRON_SECRET, VERCEL_TOKEN, OPENROUTER_*) and becomes unusable.
    const drift = diffEnvMaps(
      parseEnvFile('CRON_SECRET=real-secret\nNEXT_PUBLIC_X=1\n'),
      parseEnvFile('CRON_SECRET=\nNEXT_PUBLIC_X=1\n'),
    );
    expect(drift.valueMismatch).toEqual([]);
    expect(drift.missingInVercel).toEqual([]);
    expect(drift.valueUnreadable).toEqual([
      { key: 'CRON_SECRET', reason: expect.stringContaining('write-only') },
    ]);
  });
});

// ── parseGhSecretList ───────────────────────────────────────────────────────
describe('parseGhSecretList', () => {
  it('extracts names, skipping the table header', () => {
    const text = 'NAME            UPDATED      VISIBILITY\nVERCEL_TOKEN   2026-08-01   selected\nCRON_SECRET    2026-07-01   private\n';
    expect(parseGhSecretList(text)).toEqual(['CRON_SECRET', 'VERCEL_TOKEN']);
  });

  it('dedupes and tolerates empty output', () => {
    expect(parseGhSecretList('NAME\nA\nA\n')).toEqual(['A']);
    expect(parseGhSecretList('')).toEqual([]);
  });
});

// ── missingExpectedFlags ────────────────────────────────────────────────────
describe('missingExpectedFlags', () => {
  const DEPLOYED = parseEnvFile(
    'NEXT_PUBLIC_LIVE_REPOS=1\nNEXT_PUBLIC_LIVE_DEPLOYMENTS=1\nVERCEL_TOKEN=secret\n',
  );

  it('returns [] when every expected flag is present + enabled in the deployed store', () => {
    expect(missingExpectedFlags(EXPECTED_LIVE_FLAGS, DEPLOYED)).toEqual([]);
  });

  it('flags a flag MISSING from the deployed store (the hidden-feed incident)', () => {
    // The incident: NEXT_PUBLIC_LIVE_DEPLOYMENTS was absent from Vercel prod
    // (and .env.local), so the diff-vs-.env.local check passed while the
    // deployed app rendered demo data. The expected-set check must catch it
    // regardless of .env.local.
    const noDeployments = parseEnvFile('NEXT_PUBLIC_LIVE_REPOS=1\nVERCEL_TOKEN=secret\n');
    expect(missingExpectedFlags(EXPECTED_LIVE_FLAGS, noDeployments)).toEqual([
      { key: 'NEXT_PUBLIC_LIVE_DEPLOYMENTS', status: 'missing' },
    ]);
  });

  it('flags a flag present but DISABLED (readable value 0 is the same demo-mode bug)', () => {
    const disabled = parseEnvFile(
      'NEXT_PUBLIC_LIVE_REPOS=1\nNEXT_PUBLIC_LIVE_DEPLOYMENTS=0\nVERCEL_TOKEN=secret\n',
    );
    expect(missingExpectedFlags(EXPECTED_LIVE_FLAGS, disabled)).toEqual([
      { key: 'NEXT_PUBLIC_LIVE_DEPLOYMENTS', status: 'disabled' },
    ]);
  });

  it('satisfies the expected set for a present-but-write-only flag (empty pull = sensitive var)', () => {
    // NEXT_PUBLIC_LIVE_DEPLOYMENTS was created in Vercel prod as type
    // `sensitive`, so `env pull` returns an empty string even though the
    // deployed build inlines the real value (the live feed renders). An empty
    // pull must mean "present, value proven by the build" — NOT disabled —
    // exactly like the .env.local diff's write-only handling for secrets.
    // Failing here would false-alarm the gate on the current production env.
    const sensitive = parseEnvFile(
      'NEXT_PUBLIC_LIVE_REPOS=1\nNEXT_PUBLIC_LIVE_DEPLOYMENTS=\nVERCEL_TOKEN=secret\n',
    );
    expect(missingExpectedFlags(EXPECTED_LIVE_FLAGS, sensitive)).toEqual([]);
  });

  it('flags every missing flag, sorted in declaration order', () => {
    const empty = parseEnvFile('VERCEL_TOKEN=secret\n');
    expect(missingExpectedFlags(EXPECTED_LIVE_FLAGS, empty)).toEqual([
      { key: 'NEXT_PUBLIC_LIVE_REPOS', status: 'missing' },
      { key: 'NEXT_PUBLIC_LIVE_DEPLOYMENTS', status: 'missing' },
    ]);
  });

  it('treats an empty vercel map / empty expected set as all-missing / all-clean', () => {
    expect(missingExpectedFlags(EXPECTED_LIVE_FLAGS, parseEnvFile(''))).toHaveLength(2);
    expect(missingExpectedFlags({}, DEPLOYED)).toEqual([]);
    expect(missingExpectedFlags(undefined, DEPLOYED)).toEqual([]);
  });

  it('locks the expected LIVE_* flag set to the two live feeds', () => {
    // The set is the contract with lib/liveData.ts: repositories + deployments.
    // A new NEXT_PUBLIC_LIVE_* flag must be added here AND to lib/liveData.ts
    // together — a silent one-sided addition fails this test.
    expect(Object.keys(EXPECTED_LIVE_FLAGS).sort()).toEqual([
      'NEXT_PUBLIC_LIVE_DEPLOYMENTS',
      'NEXT_PUBLIC_LIVE_REPOS',
    ]);
    expect(EXPECTED_LIVE_FLAGS.NEXT_PUBLIC_LIVE_DEPLOYMENTS).toBe('1');
    expect(EXPECTED_LIVE_FLAGS.NEXT_PUBLIC_LIVE_REPOS).toBe('1');
  });
});

// ── classifyGithubSecrets ───────────────────────────────────────────────────
describe('classifyGithubSecrets', () => {
  it('classifies CI-only secrets (GitHub only) as expected, not drift', () => {
    const cls = classifyGithubSecrets(
      ['VERCEL_ORG_ID', 'CRON_SECRET'],
      parseEnvFile('CRON_SECRET=x'),
      parseEnvFile('CRON_SECRET=x'),
    );
    expect(cls.ciOnly).toEqual(['VERCEL_ORG_ID']);
    expect(cls.shared).toEqual(['CRON_SECRET']);
    expect(cls.localOnly).toEqual([]);
  });

  it('flags a GitHub secret that is in .env.local but missing from Vercel', () => {
    const cls = classifyGithubSecrets(
      ['CRON_SECRET'],
      parseEnvFile('CRON_SECRET=x'),
      parseEnvFile(''), // Vercel lacks it → drift
    );
    expect(cls.localOnly).toEqual(['CRON_SECRET']);
    expect(cls.shared).toEqual([]);
  });

  it('classifies Vercel-only shared secrets as informational', () => {
    const cls = classifyGithubSecrets(
      ['NEXT_PUBLIC_LIVE_GITHUB'],
      parseEnvFile(''),
      parseEnvFile('NEXT_PUBLIC_LIVE_GITHUB=1'),
    );
    expect(cls.vercelOnly).toEqual(['NEXT_PUBLIC_LIVE_GITHUB']);
    expect(cls.ciOnly).toEqual([]);
  });
});
