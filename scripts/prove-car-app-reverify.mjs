#!/usr/bin/env node
// ============================================================================
// scripts/prove-car-app-reverify.mjs — prove the car-app-ci dispatch guard
// and pinned-checkout behavior end to end, automatically.
//
// Dispatches .github/workflows/car-app-ci.yml TWICE against a target commit
// and asserts both halves of the manual re-verify contract:
//
//   Phase 1 — short sha: dispatch with the first 7 hex of the target commit.
//     The "Validate re-verify commit sha (must be full 40-hex)" step MUST
//     fail fast with the actionable message BEFORE checkout (actions/checkout
//     would mis-resolve a short sha), so the run concludes failure and the
//     Check out repository step is skipped.
//
//   Phase 2 — full 40-hex sha: dispatch with the full target commit. The
//     guard must pass, checkout must pin the requested commit (the log shows
//     `git checkout --progress --force <full sha>`), and the FULL gate suite
//     (Typecheck → Test → Build → E2E) must run against that commit — none of
//     the gate steps skipped (dispatch re-verifies unconditionally).
//
// Exits 0 only if every assertion holds; exits nonzero (with the failing
// assertion named) on any drift. Read-only against GitHub Actions — it only
// dispatches CI runs and reads their status/logs, never touches the repo.
//
// Usage:
//   node scripts/prove-car-app-reverify.mjs
//     → target = HEAD~1 of the current checkout
//   node scripts/prove-car-app-reverify.mjs --sha <full-40-hex>
//     → re-verify an explicit commit (must be a full 40-hex sha)
//   node scripts/prove-car-app-reverify.mjs --ref <branch> [--timeout-min 25]
//     → dispatch on a different ref; extend the phase-2 poll deadline
//
// Requires the gh CLI authenticated (gh auth status) with write access to
// this repo's Actions. Polls the dispatched runs to completion; phase 2 runs
// the whole gate suite, so it can take ~8 minutes (default deadline 25 min).
//
// Exports (for the unit test): parseArgs, runIdFromDispatchOutput,
// WORKFLOW_NAME, GUARD_MSG_1, GUARD_MSG_2, GATE_STEPS, checkCompletedRun.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const WORKFLOW_NAME = 'Car app CI';
export const REPO = 'LCHEROURI/portfolio-app-freebuff';
// The exact actionable guard lines the workflow emits on a short sha — the
// proof asserts these strings appear in the failed run's log, so if the
// workflow ever rewrites the message the proof (and its contract test) goes
// red instead of passing vacuously.
export const GUARD_MSG_1 = 'is not a full 40-hex commit sha. Paste the full sha';
export const GUARD_MSG_2 = '— a short sha cannot be checked out.';
// The gate steps that MUST run (not skip) on a dispatch re-verify.
export const GATE_STEPS = ['Typecheck', 'Test', 'Build'];
export const POLL_INTERVAL_S = 15;

/** Parse CLI flags: --sha <40-hex>, --ref <branch>, --timeout-min <min>. */
export function parseArgs(rawArgs) {
  const args = rawArgs.map((a) => a.trim());
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  };
  return {
    sha: flag('--sha'),
    ref: flag('--ref') ?? 'main',
    timeoutMin: Number(flag('--timeout-min') ?? 25),
  };
}

/** Extract the run database id from `gh workflow run`'s URL output. */
export function runIdFromDispatchOutput(stdout) {
  const m = String(stdout).match(/actions\/runs\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** Dispatch the car-app CI workflow with a commit_sha input; returns the run id. */
export function dispatchCommitSha(commitSha, ref) {
  const out = gh(['workflow', 'run', WORKFLOW_NAME, '--ref', ref, '-f', `commit_sha=${commitSha}`]);
  const runId = runIdFromDispatchOutput(out);
  if (!runId) throw new Error(`could not read the dispatched run id from gh output: ${out}`);
  return runId;
}

/** Poll a run until completed; returns { status, conclusion } (throws on timeout). */
export async function waitForCompletion(runId, timeoutMin) {
  const deadline = Date.now() + timeoutMin * 60_000;
  let last = { status: 'queued', conclusion: null };
  while (Date.now() < deadline) {
    const row = JSON.parse(gh(['run', 'view', String(runId), '--json', 'status,conclusion']));
    last = { status: row.status, conclusion: row.conclusion };
    if (row.status === 'completed') return last;
    const remainMin = Math.max(0, Math.round((deadline - Date.now()) / 60_000));
    process.stdout.write(`  … ${row.status} (${remainMin}m left)\r`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_S * 1000));
  }
  throw new Error(`run ${runId} did not complete within ${timeoutMin} min (last: ${last.status}/${last.conclusion})`);
}

/** The jobs of a run as { name, conclusion, steps: [{name, conclusion}] }. */
export function runJobs(runId) {
  return JSON.parse(gh(['run', 'view', String(runId), '--json', 'jobs'])).jobs;
}

/** The full log text of a run. */
export function runLog(runId) {
  try {
    return gh(['run', 'view', String(runId), '--log']);
  } catch {
    return '';
  }
}

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

/**
 * Assert the FULL contract on one already-completed run:
 *   - for the SHORT phase: conclusion failure + both guard lines in the log +
 *     the Check out repository step skipped
 *   - for the FULL phase: conclusion success + checkout pinned the full sha +
 *     guard passed + every GATE_STEPS step ran with conclusion success
 * Returns true when every assertion holds.
 */
export function checkCompletedRun(runId, { expectFailure, fullSha }) {
  const job = runJobs(runId)[0];
  if (!job) {
    check(`run ${runId} has a job`, false, 'no jobs found');
    return false;
  }
  check(`run ${runId} concluded ${expectFailure ? 'failure' : 'success'}`, job.conclusion === (expectFailure ? 'failure' : 'success'));
  const log = runLog(runId);

  if (expectFailure) {
    check(`guard message 1 in the failed log (${GUARD_MSG_1})`, log.includes(GUARD_MSG_1));
    check(`guard message 2 in the failed log (${GUARD_MSG_2})`, log.includes(GUARD_MSG_2));
    const checkoutStep = job.steps.find((s) => s.name === 'Check out repository');
    check('Check out repository step skipped (guard ran before checkout)', checkoutStep?.conclusion === 'skipped');
    return failures === 0;
  }

  check(`checkout pinned the full sha (git checkout --progress --force ${fullSha})`, log.includes(`git checkout --progress --force ${fullSha}`));
  check('guard passed (log shows the full-40-hex confirmation)', log.includes('is a full 40-hex commit'));
  for (const stepName of GATE_STEPS) {
    const step = job.steps.find((s) => s.name === stepName);
    check(`gate step ran: ${stepName}`, step?.conclusion === 'success', `conclusion=${step?.conclusion ?? 'missing'}`);
  }
  return failures === 0;
}

async function main() {
  const { sha, ref, timeoutMin } = parseArgs(process.argv.slice(2));
  if (!(timeoutMin > 0)) {
    console.error('✗ --timeout-min must be a positive number of minutes.');
    process.exit(1);
  }

  let target = sha;
  if (!target) {
    try {
      target = execFileSync('git', ['rev-parse', 'HEAD~1'], { encoding: 'utf8' }).trim();
    } catch {
      console.error('✗ no --sha given and HEAD~1 is unavailable (shallow/fresh checkout?). Pass --sha <full-40-hex>.');
      process.exit(1);
    }
  }
  if (!/^[0-9a-f]{40}$/.test(target)) {
    console.error(`✗ target sha "${target}" is not a full 40-hex commit sha — pass --sha <full-40-hex> (git rev-parse <ref>).`);
    process.exit(1);
  }
  const short = target.slice(0, 7);

  // Sanity: the guard message must exist in the workflow file, or the proof
  // would assert a string the workflow no longer emits (contract drift).
  const workflowText = readFileSync('.github/workflows/car-app-ci.yml', 'utf8');
  if (!workflowText.includes(GUARD_MSG_1) || !workflowText.includes(GUARD_MSG_2)) {
    console.error('✗ the workflow no longer contains the guard message the proof asserts — update both in the same commit.');
    process.exit(1);
  }

  console.log(`=== car-app-ci re-verify proof ===`);
  console.log(`target commit: ${target} (short ${short}) · ref ${ref} · timeout ${timeoutMin} min`);

  console.log(`\n[phase 1/2] short sha ${short} → guard must fail fast`);
  const shortRun = dispatchCommitSha(short, ref);
  console.log(`  dispatched run ${shortRun}`);
  const shortResult = await waitForCompletion(shortRun, Math.min(timeoutMin, 8));
  console.log(`  completed ${shortResult.status}/${shortResult.conclusion}`);
  checkCompletedRun(shortRun, { expectFailure: true, fullSha: target });

  console.log(`\n[phase 2/2] full sha ${target} → gate suite must run pinned to it`);
  const fullRun = dispatchCommitSha(target, ref);
  console.log(`  dispatched run ${fullRun}`);
  const fullResult = await waitForCompletion(fullRun, timeoutMin);
  console.log(`  completed ${fullResult.status}/${fullResult.conclusion}`);
  checkCompletedRun(fullRun, { expectFailure: false, fullSha: target });

  if (failures > 0) {
    console.error(`\nRESULT: FAIL (${failures} assertion${failures === 1 ? '' : 's'} failed)`);
    process.exit(1);
  }
  console.log(`\nRESULT: PASS — short sha fails at the guard; full sha runs the gate suite pinned to ${short}`);
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}