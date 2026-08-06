#!/usr/bin/env node
// ============================================================================
// scripts/gha-status.mjs — one-command GitHub Actions outage check.
//
// Fetches GitHub's public status API and, when Actions is in an outage, prints
// the outage signature (the three tells documented in the postmortem) plus the
// exact `gh run rerun` recovery steps — so the recovery in
// docs/reviews/2026-08-06-gha-outage.md is a single command instead of a doc
// lookup. Stuck queued runs / Set up job failures are then recognizable in
// seconds, and the same command tells you when it is safe to re-run.
//
// Usage:
//   npm run gha:status           # probe GitHub status, print verdict
//   node scripts/gha-status.mjs
//
// Exit codes:
//   0  Actions operational (or only degraded — warn, not fail)
//   1  Actions in an outage (major or partial) — signature + recovery printed
//   2  Status API unreachable — cannot verify either way
//
// Exports (for the unit test): parseOverallStatus, findActionsComponent,
// actionsVerdict, outageGuidance. Read-only against the GitHub status API.
// ============================================================================

import { fileURLToPath } from 'node:url';

const STATUS_URL = 'https://www.githubstatus.com/api/v2/status.json';
const COMPONENTS_URL = 'https://www.githubstatus.com/api/v2/components.json';

/**
 * Parse the overall status body ({ status: { indicator, description } }) into
 * a plain object, tolerating a malformed or absent body. Kept pure so the unit
 * test can assert the mapping without driving main().
 */
export function parseOverallStatus(body) {
  if (!body || typeof body !== 'object') return { indicator: 'unknown', description: '' };
  return {
    indicator: body.status?.indicator ?? 'unknown',
    description: body.status?.description ?? '',
  };
}

/**
 * Find the Actions component from the components.json body
 * ({ components: [{ name, status }, …] }), or null when absent. Actions is the
 * component whose outage breaks the action-download service, which is the
 * failure this helper exists to recognize.
 */
export function findActionsComponent(body) {
  const components = Array.isArray(body?.components) ? body.components : [];
  return components.find((c) => c?.name === 'Actions') ?? null;
}

/**
 * Map an Actions component status to a verdict the CLI can act on:
 *   'outage'       — major or partial outage (blocking; exit 1)
 *   'degraded'     — degraded performance (warn, not fail)
 *   'operational'  — fully up (exit 0)
 *   'unknown'      — anything else (component missing / odd status)
 */
export function actionsVerdict(status) {
  if (status === 'major_outage' || status === 'partial_outage') return 'outage';
  if (status === 'degraded_performance') return 'degraded';
  if (status === 'operational') return 'operational';
  return 'unknown';
}

/**
 * The outage guidance text: the three-tell signature plus the exact recovery
 * steps from the postmortem. Returned as a string (not printed directly) so
 * the unit test can assert its markers without capturing stdout.
 */
export function outageGuidance() {
  return [
    '',
    '  ✗ ACTIONS OUTAGE DETECTED — this is infrastructure, not your code.',
    '',
    '  The signature (all three were present in the 2026-08-06 incident):',
    '    1. Runs stuck queued for a long time (normal runs start in seconds).',
    '    2. Failure at "Set up job" before any step runs — empty step list,',
    '       `gh run view <id> --log-failed` prints nothing meaningful.',
    '    3. The same generic error across every workflow: `Service Unavailable`',
    '       / `Failed to resolve action download info`.',
    '',
    '  Recovery:',
    '    1. Stop diagnosing the repo — this check is the confirmation.',
    '    2. Wait for the queue to drain (re-run this when Actions is operational).',
    '    3. Once operational, re-run what failed:',
    '         gh run rerun <run-id>',
    '         gh run rerun <run-id> --failed',
    '    4. Never redeploy to "fix" an outage — no code changed, and a push does',
    '       not repair a run that died before downloading actions/checkout.',
    '',
  ].join('\n');
}

async function main() {
  let overallRes;
  let actionsRes;
  try {
    const [o, c] = await Promise.all([
      fetch(STATUS_URL).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) })),
      fetch(COMPONENTS_URL).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) })),
    ]);
    overallRes = o;
    actionsRes = c;
  } catch (err) {
    console.error(`✗ FAIL: could not reach the GitHub status API (${err.message})`);
    process.exit(2);
  }

  // A non-2xx status API (its own incident, a 429, a CDN 500) means we cannot
  // verify anything — surface it as the unreachable path (exit 2) instead of
  // silently reporting 'unknown' and PASS on an error page body.
  if (!overallRes.ok || !actionsRes.ok) {
    console.error(`✗ FAIL: GitHub status API returned HTTP ${!overallRes.ok ? overallRes.status : actionsRes.status}.`);
    process.exit(2);
  }

  const overallBody = overallRes.body;
  const actionsBody = actionsRes.body;

  const overall = parseOverallStatus(overallBody);
  const actions = findActionsComponent(actionsBody);
  const verdict = actionsVerdict(actions?.status);

  console.log('\nGitHub Actions status');
  console.log(`  overall ${overall.indicator} — ${overall.description || 'see status page'}`);
  console.log(`  actions ${actions?.status ?? 'not reported'} (${verdict})`);

  if (verdict === 'outage') {
    console.log(outageGuidance());
    console.error('RESULT: FAIL — GitHub Actions is in an outage.');
    process.exit(1);
  }
  if (verdict === 'degraded') {
    console.log('\n  ⚠ degraded performance — expect slower queues; runs should still start.');
    console.log('\nRESULT: PASS (degraded)');
    process.exit(0);
  }
  if (verdict === 'unknown') {
    console.log('\n  ? Actions component not reported by the status API — treat as unknown.');
    console.log('\nRESULT: PASS (unknown)');
    process.exit(0);
  }
  console.log('\nRESULT: PASS — Actions operational.');
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
