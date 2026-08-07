import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { crossCheckCiGates, parseCiGateSteps } from './launch-checklist-gates.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

// ── parseCiGateSteps: the ci.yml step parser ────────────────────────────────
describe('parseCiGateSteps (live repo)', () => {
  const steps = parseCiGateSteps(read('.github/workflows/ci.yml'));

  it('finds every gated verify step across the three post-deploy jobs', () => {
    expect(steps).toHaveLength(6);
    const byRun = new Map(steps.map((s) => [s.run, s]));
    expect([...byRun.keys()].sort()).toEqual([
      'verify-auth-domains.mjs',
      'verify-cron-reports.mjs',
      'verify-firestore-rules.mjs',
      'verify-google-idp.mjs',
      'verify-prod-signin.mjs',
      'verify-token-health.mjs',
    ]);
  });

  it('captures the secret each step gates on', () => {
    const byRun = new Map(steps.map((s) => [s.run, s]));
    expect(byRun.get('verify-token-health.mjs').gatingSecrets).toEqual(['VERCEL_TOKEN']);
    expect(byRun.get('verify-cron-reports.mjs').gatingSecrets).toEqual(['CRON_SECRET']);
    expect(byRun.get('verify-firestore-rules.mjs').gatingSecrets).toEqual(['FIREBASE_WEB_API_KEY']);
    expect(byRun.get('verify-google-idp.mjs').gatingSecrets).toEqual(['FIREBASE_WEB_API_KEY']);
    expect(byRun.get('verify-auth-domains.mjs').gatingSecrets).toEqual(['FIREBASE_WEB_API_KEY']);
    expect(byRun.get('verify-prod-signin.mjs').gatingSecrets).toEqual(['FIREBASE_WEB_API_KEY']);
  });

  it('does not pick up loud-guard, checkout, or install steps', () => {
    for (const s of steps) {
      expect(s.name).not.toMatch(/Fail loudly/);
      expect(s.name).not.toMatch(/Check out repository/);
      expect(s.name).not.toMatch(/Install Chrome/);
    }
  });
});

// ── crossCheckCiGates: live repo (the real lock) ────────────────────────────
describe('crossCheckCiGates (live repo)', () => {
  const ciSrc = read('.github/workflows/ci.yml');
  const verifyAllSrc = read('scripts/verify-all.mjs');
  const npmScripts = JSON.parse(read('package.json')).scripts ?? {};

  it('passes: every ci.yml verify step gates on secrets verify-all.mjs declares', () => {
    const failures = crossCheckCiGates({ ciSrc, verifyAllSrc, npmScripts });
    expect(failures).toEqual([]);
  });

  it('catches a CI step gated on a secret the runner never declared', () => {
    // Simulate the cron-reports step being re-gated on VERCEL_TOKEN (the
    // wrong secret) while the runner still declares CRON_SECRET.
    const drifted = ciSrc.replace(
      '        if: ${{ env.CRON_SECRET != \'\' }}\n        run: node scripts/verify-cron-reports.mjs',
      '        if: ${{ env.VERCEL_TOKEN != \'\' }}\n        run: node scripts/verify-cron-reports.mjs',
    );
    const failures = crossCheckCiGates({ ciSrc: drifted, verifyAllSrc, npmScripts });
    expect(failures.join('\n')).toContain('VERCEL_TOKEN');
    expect(failures.join('\n')).toContain('CRON_SECRET');
    expect(failures.join('\n')).toContain('cron-reports');
  });

  it('catches a verify step that lost its gating while the runner declares secrets', () => {
    // Remove the if: line from the token-health step — the runner declares
    // VERCEL_TOKEN, so an ungated step must fail the check.
    const drifted = ciSrc.replace(
      '        if: ${{ env.VERCEL_TOKEN != \'\' }}\n        run: node scripts/verify-token-health.mjs',
      '        run: node scripts/verify-token-health.mjs',
    );
    const failures = crossCheckCiGates({ ciSrc: drifted, verifyAllSrc, npmScripts });
    expect(failures.join('\n')).toContain('NO secret-gating if-condition');
    expect(failures.join('\n')).toContain('token-health');
  });

  it('catches a runner secret dropped while CI still gates on it', () => {
    // Remove VERCEL_TOKEN from the token-health gate's secrets array in the
    // runner — CI still gates on VERCEL_TOKEN, so the check must fail.
    const drifted = verifyAllSrc.replace(
      "secrets: ['VERCEL_TOKEN'], capture: true",
      'secrets: [], capture: true',
    );
    const failures = crossCheckCiGates({ ciSrc, verifyAllSrc: drifted, npmScripts });
    expect(failures.join('\n')).toContain('VERCEL_TOKEN');
    expect(failures.join('\n')).toContain('token-health');
  });
});

// ── crossCheckCiGates: synthetic fixture (deterministic) ────────────────────
describe('crossCheckCiGates (fixture)', () => {
  const FIXTURE_SRC = `
const GATE_NAMES = ['alpha', 'beta'];

const GATES = [
  { name: 'alpha', label: 'Alpha', script: 'verify:alpha', secrets: ['A_SECRET'] },
  { name: 'beta', label: 'Beta', script: 'verify:beta', secrets: [] },
];
`;
  const SCRIPTS = {
    'verify:alpha': 'node scripts/verify-alpha.mjs',
    'verify:beta': 'node scripts/verify-beta.mjs',
  };
  // The `${{ … }}` GitHub expressions must be escaped inside this template
  // literal — a bare `${{` would be parsed as a JS `${` interpolation.
  const FIXTURE_CI = `
jobs:
  verify-deployed:
    name: Verify deployed gates
    env:
      A_SECRET: \${{ secrets.A_SECRET }}
    steps:
      - name: Check out repository
        uses: actions/checkout@v5
      - name: Verify alpha
        if: \${{ env.A_SECRET != '' }}
        run: node scripts/verify-alpha.mjs
        env:
          A_SECRET: \${{ secrets.A_SECRET }}
      - name: Verify beta (no secrets, no gating)
        run: node scripts/verify-beta.mjs
`;

  it('passes on a consistent fixture (gated step + ungated no-secret step)', () => {
    const failures = crossCheckCiGates({ ciSrc: FIXTURE_CI, verifyAllSrc: FIXTURE_SRC, npmScripts: SCRIPTS });
    expect(failures).toEqual([]);
  });

  it('flags a step gated on a secret the gate does not declare', () => {
    const broken = FIXTURE_CI.replace("if: ${{ env.A_SECRET != '' }}", "if: ${{ env.B_SECRET != '' }}");
    const failures = crossCheckCiGates({ ciSrc: broken, verifyAllSrc: FIXTURE_SRC, npmScripts: SCRIPTS });
    expect(failures.join('\n')).toContain('B_SECRET');
    expect(failures.join('\n')).toContain('alpha');
  });

  it('flags an ungated step whose gate declares secrets', () => {
    const broken = FIXTURE_CI.replace(
      "        if: ${{ env.A_SECRET != '' }}\n        run: node scripts/verify-alpha.mjs",
      '        run: node scripts/verify-alpha.mjs',
    );
    const failures = crossCheckCiGates({ ciSrc: broken, verifyAllSrc: FIXTURE_SRC, npmScripts: SCRIPTS });
    expect(failures.join('\n')).toContain('NO secret-gating if-condition');
    expect(failures.join('\n')).toContain('A_SECRET');
  });

  it('fails cleanly when verify-all.mjs has no GATES array', () => {
    const src = FIXTURE_SRC.replace(/const GATES = \[[\s\S]*?\n\];/, '');
    const failures = crossCheckCiGates({ ciSrc: FIXTURE_CI, verifyAllSrc: src, npmScripts: SCRIPTS });
    expect(failures).toEqual([
      'verify-all.mjs has no GATES array — a rename or restructure broke the runner.',
    ]);
  });
});
