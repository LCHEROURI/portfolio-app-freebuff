import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { crossCheckCiGates, crossCheckDeploymentStatusGates, parseCiGateSteps, parseDeploymentStatusSteps } from './launch-checklist-gates.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

// ── parseCiGateSteps: the ci.yml step parser ────────────────────────────────
describe('parseCiGateSteps (live repo)', () => {
  const steps = parseCiGateSteps(read('.github/workflows/ci.yml'));

  it('finds every gated verify step across the three post-deploy jobs', () => {
    expect(steps).toHaveLength(7);
    const byRun = new Map(steps.map((s) => [s.run, s]));
    expect([...byRun.keys()].sort()).toEqual([
      'verify-auth-domains.mjs',
      'verify-cron-reports.mjs',
      'verify-firestore-rules.mjs',
      'verify-google-idp.mjs',
      'verify-prod-signin.mjs',
      'verify-review-sheet.mjs',
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
    // The review-sheet gate declares the SAME credential pair as prod-signin
    // (web API key + service account); both non-public secrets must be gated
    // so a missing credential skips-not-fails only on forks.
    expect(byRun.get('verify-review-sheet.mjs').gatingSecrets).toEqual(['FIREBASE_WEB_API_KEY', 'FIREBASE_SERVICE_ACCOUNT']);
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

  it('catches a gate that declares a secret no ci.yml step gates on (reverse contract)', () => {
    // Give cron-reports a SECOND declared secret (FAKE_SECRET) that no ci.yml
    // step gates on. The forward contract passes (every gated secret is still
    // declared); only the reverse contract can see the declared-but-ungated
    // FAKE_SECRET.
    const drifted = verifyAllSrc.replace(
      "secrets: ['CRON_SECRET'], capture: true",
      "secrets: ['CRON_SECRET', 'FAKE_SECRET'], capture: true",
    );
    const failures = crossCheckCiGates({ ciSrc, verifyAllSrc: drifted, npmScripts });
    expect(failures.join('\n')).toContain('FAKE_SECRET');
    expect(failures.join('\n')).toContain('cron-reports');
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

  it('flags a gate declaring a secret its ci.yml step never gates on (reverse contract)', () => {
    // alpha declares TWO secrets but its ci.yml step gates only A_SECRET.
    // Forward is satisfied (gated ⊆ declared); the reverse contract catches
    // the declared-but-ungated B_SECRET.
    const src = FIXTURE_SRC.replace(
      "{ name: 'alpha', label: 'Alpha', script: 'verify:alpha', secrets: ['A_SECRET'] }",
      "{ name: 'alpha', label: 'Alpha', script: 'verify:alpha', secrets: ['A_SECRET', 'B_SECRET'] }",
    );
    const failures = crossCheckCiGates({ ciSrc: FIXTURE_CI, verifyAllSrc: src, npmScripts: SCRIPTS });
    expect(failures.join('\n')).toContain('B_SECRET');
    expect(failures.join('\n')).toContain('alpha');
  });

  it('exempts NEXT_PUBLIC_* build vars from the reverse contract (fixture)', () => {
    // alpha declares NEXT_PUBLIC_APP_ID (a public build var) that no ci.yml
    // step gates on — the reverse contract must skip it, so the fixture stays
    // consistent.
    const src = FIXTURE_SRC.replace(
      "{ name: 'alpha', label: 'Alpha', script: 'verify:alpha', secrets: ['A_SECRET'] }",
      "{ name: 'alpha', label: 'Alpha', script: 'verify:alpha', secrets: ['A_SECRET', 'NEXT_PUBLIC_APP_ID'] }",
    );
    const failures = crossCheckCiGates({ ciSrc: FIXTURE_CI, verifyAllSrc: src, npmScripts: SCRIPTS });
    expect(failures).toEqual([]);
  });

  it('does not check gates ci.yml never exercises (no step for that gate)', () => {
    // gamma declares G_SECRET but ci.yml has no verify-gamma step — the
    // reverse contract only applies to gates ci.yml actually runs.
    const src = FIXTURE_SRC.replace(
      "const GATE_NAMES = ['alpha', 'beta'];",
      "const GATE_NAMES = ['alpha', 'beta', 'gamma'];",
    ).replace(
      "  { name: 'beta', label: 'Beta', script: 'verify:beta', secrets: [] },",
      "  { name: 'beta', label: 'Beta', script: 'verify:beta', secrets: [] },\n  { name: 'gamma', label: 'Gamma', script: 'verify:gamma', secrets: ['G_SECRET'] },",
    );
    const failures = crossCheckCiGates({ ciSrc: FIXTURE_CI, verifyAllSrc: src, npmScripts: SCRIPTS });
    expect(failures).toEqual([]);
  });
});

// ── parseDeploymentStatusSteps: the deployment_status workflow parser ───────
describe('parseDeploymentStatusSteps (live repo)', () => {
  it('reads the block-scalar verify invocation in preview-gate', () => {
    const steps = parseDeploymentStatusSteps(read('.github/workflows/preview-gate.yml'));
    const verify = steps.find((s) => s.name === 'Verify deployed domain is authorized');
    expect(verify).toBeDefined();
    expect(verify.run).toBe('verify-auth-domains.mjs');
    expect(verify.gatingSecrets).toEqual(['FIREBASE_WEB_API_KEY']);
  });

  it('reads the block-scalar verify invocation in verify-deployed-hash', () => {
    const steps = parseDeploymentStatusSteps(read('.github/workflows/verify-deployed-hash.yml'));
    const verify = steps.find((s) => s.name === 'Verify deployed commit matches the pushed head');
    expect(verify).toBeDefined();
    expect(verify.run).toBe('verify-deployed-hash.mjs');
    expect(verify.gatingSecrets).toEqual(['VERCEL_TOKEN']);
  });

  it('captures the gallery steps gated on the Vercel env trio', () => {
    const steps = parseDeploymentStatusSteps(read('.github/workflows/gallery.yml'));
    const deploy = steps.find((s) => s.name === 'Deploy preview of this branch');
    expect(deploy).toBeDefined();
    expect(deploy.gatingSecrets).toEqual(['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']);
  });
});

// ── crossCheckDeploymentStatusGates: live repo (the real lock) ──────────────
describe('crossCheckDeploymentStatusGates (live repo)', () => {
  const verifyAllSrc = read('scripts/verify-all.mjs');
  const npmScripts = JSON.parse(read('package.json')).scripts ?? {};
  const workflows = [
    { name: 'gallery', gate: 'deployed-hash', src: read('.github/workflows/gallery.yml') },
    { name: 'preview-gate', gate: 'auth-domains', src: read('.github/workflows/preview-gate.yml') },
    { name: 'verify-deployed-hash', gate: 'deployed-hash', src: read('.github/workflows/verify-deployed-hash.yml') },
  ];

  it('passes: every deployment_status workflow gates on secrets its gate declares', () => {
    const failures = crossCheckDeploymentStatusGates({ workflows, verifyAllSrc, npmScripts });
    expect(failures).toEqual([]);
  });

  it('passes through crossCheckCiGates when supplied via deploymentStatusWorkflows', () => {
    const failures = crossCheckCiGates({
      ciSrc: read('.github/workflows/ci.yml'),
      verifyAllSrc,
      npmScripts,
      deploymentStatusWorkflows: workflows,
    });
    expect(failures).toEqual([]);
  });
});

// ── crossCheckDeploymentStatusGates: synthetic fixture ──────────────────────
describe('crossCheckDeploymentStatusGates (fixture)', () => {
  const FIXTURE_SRC = `
const GATE_NAMES = ['deployed-hash', 'auth-domains'];

const GATES = [
  { name: 'deployed-hash', label: 'Deployed hash', script: 'verify:deployed-hash', secrets: ['VERCEL_TOKEN'] },
  { name: 'auth-domains', label: 'Auth domains', script: 'verify:auth-domains', secrets: ['FIREBASE_WEB_API_KEY'] },
];
`;
  const SCRIPTS = {
    'verify:deployed-hash': 'node scripts/verify-deployed-hash.mjs',
    'verify:auth-domains': 'node scripts/verify-auth-domains.mjs',
  };
  // The `${{ … }}` GitHub expressions must be escaped inside these template
  // literals — a bare `${{` would be parsed as a JS `${` interpolation.
  const FIXTURE_GALLERY = `
jobs:
  capture:
    env:
      VERCEL_TOKEN: \${{ secrets.VERCEL_TOKEN }}
      VERCEL_ORG_ID: \${{ secrets.VERCEL_ORG_ID }}
    steps:
      - name: Deploy preview
        if: \${{ env.VERCEL_TOKEN != '' && env.VERCEL_ORG_ID != '' }}
        run: npx --yes vercel deploy --prebuilt
`;
  const FIXTURE_PREVIEW = `
jobs:
  verify-preview-auth-domains:
    steps:
      - name: Verify deployed domain is authorized
        if: \${{ env.FIREBASE_WEB_API_KEY != '' }}
        run: |
          run_verify() {
            node scripts/verify-auth-domains.mjs --app "\${{ github.event.deployment_status.target_url }}"
          }
          if run_verify; then
            echo "preview-gate: authorized"
          else
            exit 1
          fi
`;

  it('passes on a consistent gallery (declared token + exempt infra secrets)', () => {
    const failures = crossCheckDeploymentStatusGates({
      workflows: [{ name: 'gallery', gate: 'deployed-hash', src: FIXTURE_GALLERY }],
      verifyAllSrc: FIXTURE_SRC,
      npmScripts: SCRIPTS,
    });
    expect(failures).toEqual([]);
  });

  it('passes on a consistent preview-gate (block-scalar run resolved to auth-domains)', () => {
    const failures = crossCheckDeploymentStatusGates({
      workflows: [{ name: 'preview-gate', gate: 'auth-domains', src: FIXTURE_PREVIEW }],
      verifyAllSrc: FIXTURE_SRC,
      npmScripts: SCRIPTS,
    });
    expect(failures).toEqual([]);
  });

  it('flags a workflow that gates on a secret its mapped gate never declared', () => {
    const broken = FIXTURE_GALLERY.replace("env.VERCEL_ORG_ID != ''", "env.VERCEL_ORG_ID != '' && env.CRON_SECRET != ''");
    const failures = crossCheckDeploymentStatusGates({
      workflows: [{ name: 'gallery', gate: 'deployed-hash', src: broken }],
      verifyAllSrc: FIXTURE_SRC,
      npmScripts: SCRIPTS,
    });
    expect(failures.join('\n')).toContain('CRON_SECRET');
    expect(failures.join('\n')).toContain('deployed-hash');
  });

  it('flags a workflow that never gates its mapped gate declared secret', () => {
    // Drop VERCEL_TOKEN from the gating entirely — the deployed-hash gate
    // declares it, so the workflow must gate on it somewhere.
    const broken = FIXTURE_GALLERY.replace("env.VERCEL_TOKEN != '' && ", '');
    const failures = crossCheckDeploymentStatusGates({
      workflows: [{ name: 'gallery', gate: 'deployed-hash', src: broken }],
      verifyAllSrc: FIXTURE_SRC,
      npmScripts: SCRIPTS,
    });
    expect(failures.join('\n')).toContain('never gates on VERCEL_TOKEN');
    expect(failures.join('\n')).toContain('deployed-hash');
  });

  it('flags a workflow mapped to a gate verify-all.mjs does not declare', () => {
    const failures = crossCheckDeploymentStatusGates({
      workflows: [{ name: 'gallery', gate: 'ghost-gate', src: FIXTURE_GALLERY }],
      verifyAllSrc: FIXTURE_SRC,
      npmScripts: SCRIPTS,
    });
    expect(failures.join('\n')).toContain('ghost-gate');
    expect(failures.join('\n')).toContain('does not declare');
  });
});
