import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/check-rollout-health.test.ts — lock the rollout-health issue +
// webhook severity routing for EVERY classifier verdict.
//
// The scheduled watch (rollout-health.yml) classifies the newest App Hosting
// rollout with scripts/check-rollout-health.sh, which emits one verdict per
// branch as `outcome=<x>` / `severity=<page|warning>`. The workflow then
// routes that verdict into two alert surfaces:
//
//   • deploy-failure issue — filed/updated for every NON-healthy outcome
//     (test_mode excluded), closed on healthy.
//   • webhook — severity-routed: page-tier outcomes POST to the page channel
//     (ALERT_WEBHOOK_URL); the single warning-tier outcome (stale) may only
//     POST to the quiet channel (ALERT_WEBHOOK_URL_QUIET) and must NEVER
//     page; with no webhook secret, the issue alone covers it.
//
// This test reads the REAL script, workflow, and runbook from disk (never
// fixtures, mirroring the repo's contract-test discipline) and:
//
//   1. Parses every verdict the script can actually emit (the classifier's
//      verdict output) and asserts the documented outcome → severity map.
//   2. Mocks each verdict and runs it through a pure router that mirrors the
//      workflow's gates, asserting the issue + webhook decision for every
//      outcome under every webhook-secret combination.
//   3. Locks the real workflow YAML to that same contract (exact `if:`
//      gates, the quiet-branch guard, and the ordering that makes stale
//      unable to page).
//   4. Runs mutation drills: a severity flip, a dropped quiet branch, or a
//      weakened gate must FAIL here, so a future edit cannot silently change
//      who gets paged when the watch finds something wrong.
// ============================================================================

const SCRIPT = readFileSync('scripts/check-rollout-health.sh', 'utf8');
const WORKFLOW = readFileSync('.github/workflows/rollout-health.yml', 'utf8');
const RUNBOOK = readFileSync('docs/car-app-runbook.md', 'utf8');
const DEPLOY_CAR = readFileSync('.github/workflows/deploy-car-app.yml', 'utf8');
const DEPLOY_PORTFOLIO = readFileSync('.github/workflows/deploy-portfolio-app.yml', 'utf8');

// ── The classifier's verdict output: what the script can actually emit ──────
type Outcome =
  | 'healthy'
  | 'failed'
  | 'stuck'
  | 'stale'
  | 'unreachable'
  | 'unprovenanced'
  | 'degraded';
type Severity = 'page' | 'warning';

// Parse every `outcome=<x>` echo from the REAL script and collect the
// severity emitted alongside it (the script pairs them adjacently in each
// verdict branch). healthy is emitted twice (deploy-in-flight detail line
// carries no severity; the final success line carries severity=page).
function scriptVerdicts(): Record<Outcome, Set<Severity>> {
  const found = {} as Record<Outcome, Set<Severity>>;
  const outcomeRe = /echo "outcome=([a-z]+)"/g;
  for (const m of SCRIPT.matchAll(outcomeRe)) {
    const outcome = m[1] as Outcome;
    if (!found[outcome]) found[outcome] = new Set();
    const from = m.index! + m[0].length;
    const next = SCRIPT.slice(from, from + 120);
    const sev = next.match(/echo "severity=([a-z]+)"/)?.[1] as Severity | undefined;
    if (sev) found[outcome].add(sev);
  }
  return found;
}

// ── The workflow's routing, mirrored as a pure function ─────────────────────
// This is the unit under test. It reproduces rollout-health.yml exactly:
//   issue step:      outcome != 'healthy' && test_mode != 'true'
//   webhook step:    outcome != 'healthy'
//   webhook body:    severity=warning → quiet channel only, then exit 0
//                    (never the page channel); everything else → page channel
//   close step:      outcome == 'healthy'
interface Verdict {
  outcome: Outcome;
  severity: Severity;
  testMode?: boolean;
}
interface Routing {
  filesIssue: boolean;
  webhook: 'page' | 'quiet' | 'none';
  closesIssue: boolean;
}
function routeVerdict(v: Verdict, env: { pageUrl: string; quietUrl: string }): Routing {
  const healthy = v.outcome === 'healthy';
  if (healthy) return { filesIssue: false, webhook: 'none', closesIssue: true };
  const filesIssue = !v.testMode; // test_mode=true skips the issue step (prove-webhook mode)
  const webhook: Routing['webhook'] =
    v.severity === 'warning'
      ? env.quietUrl
        ? 'quiet'
        : 'none'
      : env.pageUrl
        ? 'page'
        : 'none';
  return { filesIssue, webhook, closesIssue: false };
}

// ── The documented contract for every outcome ───────────────────────────────
// severity: what the classifier header + runbook promise the script emits.
// The routing is DERIVED (not restated) in the per-outcome asserts below.
const CONTRACT: Record<
  Outcome,
  { severity: Severity; issue: boolean; webhook: 'page' | 'quiet' | 'none'; close: boolean }
> = {
  healthy: { severity: 'page', issue: false, webhook: 'none', close: true },
  failed: { severity: 'page', issue: true, webhook: 'page', close: false },
  stuck: { severity: 'page', issue: true, webhook: 'page', close: false },
  stale: { severity: 'warning', issue: true, webhook: 'quiet', close: false },
  unreachable: { severity: 'page', issue: true, webhook: 'page', close: false },
  unprovenanced: { severity: 'page', issue: true, webhook: 'page', close: false },
  degraded: { severity: 'page', issue: true, webhook: 'page', close: false },
};
const ALL_OUTCOMES = Object.keys(CONTRACT) as Outcome[];

const BOTH_WEBHOOKS = { pageUrl: 'https://page.example', quietUrl: 'https://quiet.example' };

describe('check-rollout-health.sh · every verdict the classifier emits', () => {
  const verdicts = scriptVerdicts();

  it('can emit every outcome in the documented contract', () => {
    for (const outcome of ALL_OUTCOMES) {
      expect(verdicts[outcome], `script never emits outcome=${outcome}`).toBeDefined();
      expect(verdicts[outcome].size).toBeGreaterThan(0);
    }
  });

  it('maps each outcome to exactly the documented severity (stale=warning, everything else page)', () => {
    for (const outcome of ALL_OUTCOMES) {
      expect(verdicts[outcome].has(CONTRACT[outcome].severity), `${outcome} must carry severity=${CONTRACT[outcome].severity}`)
        .toBe(true);
    }
    // Stale is the ONLY warning-tier verdict — page severities never leak in.
    for (const outcome of ALL_OUTCOMES) {
      const warning = verdicts[outcome].has('warning');
      expect(warning, `only stale may carry severity=warning (${outcome} does)`).toBe(outcome === 'stale');
    }
  });

  it('emits a severity for every branch — the workflow defaults a missing severity to page', () => {
    // Every non-healthy branch pairs its outcome with an explicit severity;
    // healthy's final line carries severity=page. A branch that drops its
    // severity would route through the workflow's `${SEVERITY:-page}` default,
    // silently paging for a verdict the docs call quiet.
    for (const outcome of ALL_OUTCOMES) {
      expect(verdicts[outcome].size, `${outcome} must pair with exactly one severity`).toBe(1);
    }
  });
});

describe('issue + webhook severity routing · every outcome, every secret combo', () => {
  it('healthy: no issue, no webhook, closes any open deploy-failure issue', () => {
    const r = routeVerdict({ outcome: 'healthy', severity: 'page' }, BOTH_WEBHOOKS);
    expect(r).toEqual({ filesIssue: false, webhook: 'none', closesIssue: true });
  });

  it('page-tier outcomes (failed, stuck, unreachable, unprovenanced, degraded): issue + page webhook', () => {
    for (const outcome of ['failed', 'stuck', 'unreachable', 'unprovenanced', 'degraded'] as const) {
      const r = routeVerdict({ outcome, severity: 'page' }, BOTH_WEBHOOKS);
      expect(r, outcome).toEqual({ filesIssue: true, webhook: 'page', closesIssue: false });
    }
  });

  it('stale (warning): still records the issue, but never pages — quiet channel when one exists', () => {
    const withQuiet = routeVerdict({ outcome: 'stale', severity: 'warning' }, BOTH_WEBHOOKS);
    expect(withQuiet).toEqual({ filesIssue: true, webhook: 'quiet', closesIssue: false });
    // No quiet channel configured → the issue alone covers it; still no page.
    const noQuiet = routeVerdict({ outcome: 'stale', severity: 'warning' }, { pageUrl: 'https://page.example', quietUrl: '' });
    expect(noQuiet).toEqual({ filesIssue: true, webhook: 'none', closesIssue: false });
  });

  it('stale can NEVER reach the page channel, even when only the page webhook exists', () => {
    const pageOnly = routeVerdict({ outcome: 'stale', severity: 'warning' }, { pageUrl: 'https://page.example', quietUrl: '' });
    expect(pageOnly.webhook).not.toBe('page');
  });

  it('page-tier without the page webhook secret → the issue alone covers it (no false page)', () => {
    for (const outcome of ['failed', 'stuck', 'unreachable', 'unprovenanced', 'degraded'] as const) {
      const r = routeVerdict({ outcome, severity: 'page' }, { pageUrl: '', quietUrl: 'https://quiet.example' });
      expect(r, outcome).toEqual({ filesIssue: true, webhook: 'none', closesIssue: false });
    }
  });

  it('test_mode (webhook proof mode) skips the issue step but still sends the page webhook', () => {
    const r = routeVerdict({ outcome: 'failed', severity: 'page', testMode: true }, BOTH_WEBHOOKS);
    expect(r).toEqual({ filesIssue: false, webhook: 'page', closesIssue: false });
  });
});

describe('.github/workflows/rollout-health.yml · workflow text matches the router', () => {
  it('gates the issue step on every non-healthy outcome, excluding test_mode', () => {
    expect(WORKFLOW).toContain(
      "if: steps.classify.outputs.outcome != 'healthy' && steps.classify.outputs.test_mode != 'true'",
    );
  });

  it('gates the webhook step on every non-healthy outcome', () => {
    expect(WORKFLOW).toContain("if: steps.classify.outputs.outcome != 'healthy'");
  });

  it('gates the close step on healthy only', () => {
    expect(WORKFLOW).toContain("if: steps.classify.outputs.outcome == 'healthy'");
  });

  it('routes warning to the QUIET channel only — the page channel is unreachable from stale', () => {
    // The quiet branch must be guarded by the severity=warning check, must
    // reference ONLY the quiet URL, and must exit 0 BEFORE the page-channel
    // send — so a stale verdict can never fall through to the page webhook.
    expect(WORKFLOW).toContain('if [ "$SEVERITY" = "warning" ]');
    const quietCurl = WORKFLOW.indexOf('"$ALERT_WEBHOOK_URL_QUIET"');
    const pageCurl = WORKFLOW.indexOf('"$ALERT_WEBHOOK_URL"');
    const quietExit = WORKFLOW.indexOf('exit 0', quietCurl);
    expect(quietCurl).toBeGreaterThan(-1);
    expect(pageCurl).toBeGreaterThan(quietCurl);
    expect(quietExit).toBeGreaterThan(quietCurl);
    expect(quietExit).toBeLessThan(pageCurl);
    // The warning branch must never reference the page channel.
    const warningBranch = WORKFLOW.slice(WORKFLOW.indexOf('if [ "$SEVERITY" = "warning" ]'), pageCurl);
    expect(warningBranch).toContain('ALERT_WEBHOOK_URL_QUIET');
    expect(warningBranch).not.toContain('webhook_delivery=page-channel');
  });

  it('defaults a missing severity to page (the in-flight healthy detail line) — harmless because the gate is on outcome', () => {
    expect(WORKFLOW).toContain('severity=${SEVERITY:-page}');
  });

  it('announces page-channel delivery explicitly for page-tier sends', () => {
    expect(WORKFLOW).toContain('echo "webhook_delivery=page-channel"');
    expect(WORKFLOW).toContain('echo "webhook_delivery=quiet-channel"');
  });
});

describe('.github/workflows/rollout-health.yml · test_webhook preflight guard', () => {
  // A test_webhook=true dispatch exists to PROVE page-tier webhook delivery
  // end to end. With ALERT_WEBHOOK_URL missing it must fail fast and loudly
  // with the exact setup message — before the classify/issue steps run —
  // rather than succeeding at classification and failing deep inside the
  // webhook step. The step is gated on the input so scheduled runs and
  // ordinary dispatches never touch it.
  const PREFLIGHT_MSG =
    "::error::Webhook test FAILED — ALERT_WEBHOOK_URL is not set in this repo's Actions secrets. Set it with: gh secret set ALERT_WEBHOOK_URL --repo $GITHUB_REPOSITORY";

  it('fails a test_webhook dispatch when ALERT_WEBHOOK_URL is missing, with the exact message', () => {
    expect(WORKFLOW).toContain('name: Preflight webhook secret (test_webhook dispatch)');
    expect(WORKFLOW).toContain("if: ${{ inputs.test_webhook == true }}");
    expect(WORKFLOW).toContain(PREFLIGHT_MSG);
    expect(WORKFLOW).toContain('exit 1');
  });

  it('runs the preflight BEFORE any gcloud/Firebase work', () => {
    const preflightStart = WORKFLOW.indexOf('Preflight webhook secret');
    const checkoutStart = WORKFLOW.indexOf('uses: actions/checkout@v5');
    const activateStart = WORKFLOW.indexOf('Activate service account');
    expect(preflightStart).toBeGreaterThan(-1);
    expect(checkoutStart).toBeGreaterThan(preflightStart);
    expect(activateStart).toBeGreaterThan(preflightStart);
  });

  it('leaves the downstream safety-net check in the webhook step', () => {
    // The preflight makes the failure fast; the webhook step's own guard
    // remains the safety net for any path that reaches it without the
    // secret. Both must carry the identical message so alerts are uniform.
    const webhookStep = WORKFLOW.slice(WORKFLOW.indexOf('Send webhook alert'));
    expect(webhookStep).toContain(PREFLIGHT_MSG);
  });

  it('catches the preflight being dropped (mutation)', () => {
    const dropped = WORKFLOW.replace(
      '      - name: Preflight webhook secret (test_webhook dispatch)',
      '      - name: (preflight removed)',
    );
    expect(dropped, 'the preflight-drop mutation must actually land').not.toBe(WORKFLOW);
    expect(() => {
      expect(dropped).toContain('name: Preflight webhook secret (test_webhook dispatch)');
    }).toThrow();
  });

  it('catches the preflight gate being removed so it would run on every dispatch (mutation)', () => {
    const ungated = WORKFLOW.replace(
      "        if: ${{ inputs.test_webhook == true }}\n",
      '',
    );
    expect(ungated, 'the gate-removal mutation must actually land').not.toBe(WORKFLOW);
    expect(() => {
      expect(ungated).toContain("if: ${{ inputs.test_webhook == true }}");
    }).toThrow();
  });
});

describe('deploy workflows · webhook steps must be failure-gated', () => {
  // Found live: the notify-failure webhook step in both deploy workflows was
  // gated ONLY on ALERT_WEBHOOK_URL being set, so every successful deploy
  // paged a false "deploy FAILED" alert (run 33990351688 sent "🚨
  // freebuff-car-app deploy FAILED" from a SUCCEEDED run). The step runs
  // inside an `if: always()` job, so it must ALSO require the deploy result
  // to actually be 'failure' — mirroring the issue step right above it.
  it('car-app deploy webhook fires only on an actual failure', () => {
    expect(DEPLOY_CAR).toContain("if: ${{ needs.deploy.result == 'failure' && env.ALERT_WEBHOOK_URL != '' }}");
  });

  it('portfolio deploy webhook fires only on an actual failure', () => {
    expect(DEPLOY_PORTFOLIO).toContain("if: ${{ needs.deploy.result == 'failure' && env.ALERT_WEBHOOK_URL != '' }}");
  });

  it('catches the webhook gate regressing to env-only (mutation)', () => {
    const regressed = DEPLOY_CAR.replace(
      "if: ${{ needs.deploy.result == 'failure' && env.ALERT_WEBHOOK_URL != '' }}",
      "if: env.ALERT_WEBHOOK_URL != ''",
    );
    expect(regressed, 'the env-only regression must actually land').not.toBe(DEPLOY_CAR);
    expect(() => {
      expect(regressed).toContain("if: ${{ needs.deploy.result == 'failure' && env.ALERT_WEBHOOK_URL != '' }}");
    }).toThrow();
  });
});

describe('docs/car-app-runbook.md · alert section agrees with the routing', () => {
  it('documents the shared deploy-failure issue and auto-close on healthy', () => {
    expect(RUNBOOK).toContain('deploy-failure');
    expect(RUNBOOK).toContain('same issue auto-closed when the watch classifies `healthy`');
    expect(RUNBOOK).toContain('rollout-health.yml');
  });

  it('documents the page-tier classes (stale excluded from the page set)', () => {
    expect(RUNBOOK).toContain('stale');
    expect(RUNBOOK).toContain('unprovenanced');
    expect(RUNBOOK).toContain('unreachable');
    expect(RUNBOOK).toContain('FAILED rollouts');
  });
});

describe('mutation drills · the contract pins have discriminating power', () => {
  it('FAILS when stale is (mis)classified as severity=page in the script', () => {
    // If the classifier ever emits severity=page for stale, the router must
    // page for it — which violates the contract. Prove the severity pin on
    // scriptVerdicts catches a mutated copy.
    const mutated = SCRIPT.replace(
      /outcome=stale"[\s\S]*?severity=warning/,
      'outcome=stale"\n    echo "severity=page',
    );
    expect(mutated, 'the stale-severity mutation must actually land').not.toBe(SCRIPT);
    expect(mutated).toMatch(/outcome=stale"[\s\S]*?severity=page/);
    const drilled = (src: string) => {
      const found = {} as Record<string, Set<string>>;
      const re = /echo "outcome=([a-z]+)"/g;
      for (const m of src.matchAll(re)) {
        const outcome = m[1];
        if (!found[outcome]) found[outcome] = new Set();
        const sev = src.slice(m.index! + m[0].length, m.index! + m[0].length + 120).match(/echo "severity=([a-z]+)"/)?.[1];
        if (sev) found[outcome].add(sev);
      }
      return found;
    };
    const verdicts = drilled(mutated);
    expect(verdicts.stale.has('warning')).toBe(false);
    expect(verdicts.stale.has('page')).toBe(true);
    expect(() => {
      for (const outcome of ALL_OUTCOMES) {
        expect(verdicts[outcome].has(CONTRACT[outcome].severity)).toBe(true);
      }
    }).toThrow();
  });

  it('FAILS when the workflow drops the quiet branch (stale would page or nothing)', () => {
    const withoutQuiet = WORKFLOW.replace(
      'if [ "$SEVERITY" = "warning" ] && [ "$TEST_MODE" != "true" ]; then',
      'if [ "$SEVERITY" = "page" ] && [ "$TEST_MODE" != "true" ]; then',
    );
    expect(withoutQuiet, 'the quiet-branch mutation must actually land').not.toBe(WORKFLOW);
    const quietCurl = withoutQuiet.indexOf('"$ALERT_WEBHOOK_URL_QUIET"');
    const pageCurl = withoutQuiet.indexOf('"$ALERT_WEBHOOK_URL"');
    const quietExit = withoutQuiet.indexOf('exit 0', quietCurl);
    expect(() => {
      expect(withoutQuiet).toContain('if [ "$SEVERITY" = "warning" ]');
      expect(quietExit).toBeLessThan(pageCurl);
    }).toThrow();
  });

  it('FAILS when the issue step gate is weakened to a single outcome', () => {
    const weakened = WORKFLOW.replace(
      "steps.classify.outputs.outcome != 'healthy' && steps.classify.outputs.test_mode != 'true'",
      "steps.classify.outputs.outcome == 'failed' && steps.classify.outputs.test_mode != 'true'",
    );
    expect(weakened, 'the gate-weakening mutation must actually land').not.toBe(WORKFLOW);
    expect(() => {
      expect(weakened).toContain(
        "if: steps.classify.outputs.outcome != 'healthy' && steps.classify.outputs.test_mode != 'true'",
      );
    }).toThrow();
  });
});