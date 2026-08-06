#!/usr/bin/env node
// ============================================================================
// scripts/verify-all.mjs — one-command launch-checklist runner.
//
// Runs every verification gate documented in docs/launch.md §4 sequentially
// against production (or an --app override), so the go-live checklist is
// executable in a single command:
//
//   npm run verify:all                       # all eight gates, production URL
//   node scripts/verify-all.mjs --app http://localhost:3000
//   node scripts/verify-all.mjs --only prod-signin,google-idp
//   node scripts/verify-all.mjs --skip prod-signin --timeout 900
//   node scripts/verify-all.mjs --expect <sha>   # forward a deployed-hash assertion
//
// Behavior:
//   - Preflights the static launch-checklist drift guard
//     (scripts/verify-launch-checklist.mjs) first: if the doc promises a gate
//     the repo can't run, nothing is executed.
//   - Runs each gate as a child process with inherited stdio (live output),
//     capturing exit code + wall time per gate.
//   - Dedupes the §4 table's double auth-domains entry: the table lists both
//     `npm run verify:auth-domains` and `node scripts/verify-auth-domains.mjs`,
//     which resolve to the SAME file — only the canonical npm script runs, and
//     the duplicate row is reported as covered.
//   - Prints a summary table and exits nonzero if any gate failed.
//
// Secrets are read by each gate from its own env / .env.local — this runner
// only passes the app URL override. Exit code = count of failed gates.
// ============================================================================

import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const APP = (flag('--app', process.env.VERIFY_BASE_URL) ?? '').replace(/\/$/, '');
const TIMEOUT_SEC = Number(flag('--timeout', '600'));
const onlyArg = flag('--only', '');
const skipArg = flag('--skip', '');
const EXPECT_SHA = flag('--expect', '');
// The canonical production URL the deployed-hash gate's drift watch compares
// against (the alias must serve the same commit as the deployment-specific
// URL). Matches scripts/verify-deployed-hash.mjs's PRODUCTION_URL.
const PRODUCTION_URL = 'https://portfolio-app-freebuff.vercel.app';
const ONLY = onlyArg ? onlyArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
const SKIP = skipArg ? skipArg.split(',').map((s) => s.trim()).filter(Boolean) : [];

const GATE_NAMES = ['token-health', 'cron-email', 'firestore-rules', 'auth-domains', 'prod-signin', 'google-idp', 'auth-domains-direct', 'deployed-hash'];
const unknownOnly = ONLY.filter((n) => !GATE_NAMES.includes(n));
const unknownSkip = SKIP.filter((n) => !GATE_NAMES.includes(n));
if (unknownOnly.length > 0 || unknownSkip.length > 0) {
  console.error(`✗ unknown gate name(s) — --only: ${unknownOnly.join(', ') || '—'}; --skip: ${unknownSkip.join(', ') || '—'}`);
  console.error(`  valid names: ${GATE_NAMES.join(', ')}`);
  process.exit(2);
}

// ── Gate table (mirrors docs/launch.md §4) ──────────────────────────────────
// npm gates spawn `npm run <script>`; node gates spawn `node <file>`.
// `baseFlag` / `appFlag` declare which CLI flag the gate accepts for the app
// URL override (each gate names its own flag: --base for cron-email, --app
// for the others). `duplicateOf` marks a row that resolves to the same file
// as an earlier gate — it is reported but not re-run.
const GATES = [
  // The token-health gate runs FIRST: it proves the VERCEL_TOKEN is alive
  // before any gate that depends on a deployment or CI credential runs — a
  // revoked token is caught in ~1s instead of surfacing as a confusing 403
  // inside a later gate. Same rc=2 contract as the deployed-hash gate.
  { name: 'token-health', label: 'Vercel token health', script: 'verify:token-health' },
  { name: 'cron-email', label: 'Cron email bodies', script: 'verify:cron-email', baseFlag: '--base' },
  { name: 'firestore-rules', label: 'Firestore rules isolation', script: 'verify:firestore-rules' },
  { name: 'auth-domains', label: 'Authorized domains', script: 'verify:auth-domains', appFlag: '--app' },
  { name: 'prod-signin', label: 'Production sign-in + Firestore sync', script: 'verify:prod-signin', appFlag: '--app' },
  { name: 'google-idp', label: 'Google IdP record', script: 'verify:google-idp' },
  { name: 'auth-domains-direct', label: 'Authorized domains (direct script)', file: 'scripts/verify-auth-domains.mjs', appFlag: '--app', duplicateOf: 'auth-domains' },
  { name: 'deployed-hash', label: 'Deployed commit matches expected', script: 'verify:deployed-hash', expectFlag: '--expect', url: PRODUCTION_URL },
];

const failures = [];
const results = [];

const pad = (s, n) => String(s).padEnd(n);

const KILL_GRACE_SEC = 10;

const runOne = async (gate) => {
  const started = Date.now();
  const cmd = gate.file ? 'node' : 'npm';
  const cmdArgs = gate.file ? [gate.file] : ['run', gate.script];
  if (APP) {
    if (gate.baseFlag) cmdArgs.push(gate.baseFlag, APP);
    if (gate.appFlag) cmdArgs.push(gate.appFlag, APP);
  }
  // The deployed-hash gate resolves the CANONICAL production URL as its
  // primary target via `--url <canonical>` (v13 by-host lookup with a bare
  // unscoped fallback — no team-scope resolution needed, so a team-scoped
  // token or missing defaultTeamId can never send it down the v6 list branch
  // and 403). It takes its assertion via `-- --expect <sha>`; the runner
  // forwards the user's --expect value through npm run. Without one, fall
  // back to --check-local so the row still does a real comparison (deployed
  // commit vs local HEAD) instead of silently reporting only. The alias-
  // routing drift watch is not run here: with the canonical URL as the
  // primary target, comparing it against itself would be a tautology — its
  // real home is the CI deployment_status workflow, where the deployment-
  // specific target_url and the canonical alias are both known.
  if (gate.expectFlag || gate.url) {
    cmdArgs.push('--');
    if (gate.url) cmdArgs.push('--url', gate.url);
    if (gate.expectFlag) {
      cmdArgs.push(EXPECT_SHA ? gate.expectFlag : '--check-local');
      if (EXPECT_SHA) cmdArgs.push(EXPECT_SHA);
    }
  }

  console.log(`\n── ▶ ${gate.label} (${cmd} ${cmdArgs.join(' ')})`);
  const child = spawn(cmd, cmdArgs, { stdio: 'inherit', env: process.env });
  let timedOut = false;
  let settled = false;
  let timer;
  let killTimer;

  // Timeout that CANNOT hang the suite: SIGTERM, then SIGKILL after a short
  // grace, and the promise is resolved from the timer itself so a gate that
  // ignores signals (hung Chrome CDP, stuck fetch) can never leave the runner
  // waiting forever on an 'exit' event that never fires.
  const forceResolve = (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(killTimer);
    resolveGate(code);
  };
  let resolveGate;
  const exitPromise = new Promise((resolvePromise) => {
    resolveGate = (code) => resolvePromise(code);
    child.on('exit', (c) => forceResolve(c ?? 1));
    child.on('error', (err) => {
      console.error(`    ✗ failed to spawn: ${err.message}`);
      forceResolve(1);
    });
  });
  timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      forceResolve(1);
    }, KILL_GRACE_SEC * 1000);
  }, TIMEOUT_SEC * 1000);

  const code = await exitPromise;
  clearTimeout(timer);
  clearTimeout(killTimer);
  const ms = Date.now() - started;
  const pass = !timedOut && code === 0;
  if (!pass) {
    failures.push(gate.name);
    console.error(timedOut
      ? `    ✗ TIMED OUT after ${TIMEOUT_SEC}s`
      : `    ✗ exited with code ${code}`);
  }
  results.push({ gate, pass, timedOut, ms });
};

// ── Preflight: the doc's gates must be runnable before we run any ───────────
console.log(`\nLaunch checklist runner — ${APP || 'production URL (default)'}\n`);
console.log('[0/8] Preflight: launch-checklist drift guard');
const preflight = spawn('node', ['scripts/verify-launch-checklist.mjs'], { stdio: 'inherit', env: process.env });
const preflightCode = await new Promise((resolvePromise) => {
  preflight.on('exit', (c) => resolvePromise(c ?? 1));
  preflight.on('error', (err) => {
    console.error(`    ✗ preflight spawn failed: ${err.message}`);
    resolvePromise(1);
  });
});
if (preflightCode !== 0) {
  console.error('\n✗ Preflight failed — docs/launch.md promises gates the repo cannot run.');
  console.error('  Fix the checklist or the scripts, then re-run verify:all.');
  process.exit(1);
}

// ── Run the gates ───────────────────────────────────────────────────────────
let idx = 0;
for (const gate of GATES) {
  idx += 1;
  const name = gate.name;
  if (ONLY.length && !ONLY.includes(name)) continue;
  if (SKIP.includes(name)) {
    console.log(`\n── ▷ ${gate.label} — skipped (--skip ${name})`);
    results.push({ gate, pass: null, timedOut: false, ms: 0 });
    continue;
  }
  // Dedupe: this row resolves to the same file as its duplicateOf gate, which
  // already ran (or is scheduled to run) in the same invocation.
  if (gate.duplicateOf) {
    const parentRan = !ONLY.length || ONLY.includes(gate.duplicateOf);
    if (parentRan && !SKIP.includes(gate.duplicateOf)) {
      console.log(`\n── ▷ ${gate.label} — covered by ${gate.duplicateOf} (same script file, not re-run)`);
      results.push({ gate, pass: 'covered', timedOut: false, ms: 0 });
      continue;
    }
  }
  await runOne(gate);
}

// ── Summary table ───────────────────────────────────────────────────────────
console.log('\n\n══════════════════════════════════════════════════════════');
console.log('  VERIFY-ALL SUMMARY');
console.log('══════════════════════════════════════════════════════════');
const statusOf = (r) =>
  r.pass === null ? 'SKIPPED'
  : r.pass === 'covered' ? 'COVERED'
  : r.pass ? 'PASS'
  : r.timedOut ? `TIMEOUT (${TIMEOUT_SEC}s)`
  : 'FAIL';
const w = Math.max(...results.map((r) => r.gate.label.length), 'GATE'.length);
console.log(`  ${pad('GATE', w)}  STATUS   TIME`);
console.log(`  ${'-'.repeat(w)}  -------  -----`);
for (const r of results) {
  const time = r.pass === null || r.pass === 'covered' ? '—' : `${(r.ms / 1000).toFixed(1)}s`;
  console.log(`  ${pad(r.gate.label, w)}  ${pad(statusOf(r), 7)}  ${time}`);
}
console.log('══════════════════════════════════════════════════════════');

const ranCount = results.filter((r) => r.pass !== null && r.pass !== 'covered').length;
if (ranCount === 0) {
  console.error('\nRESULT: FAIL — no gates ran (--only/--skip filtered everything out).');
  process.exit(2);
}

const failedCount = failures.length;
if (failedCount > 0) {
  console.error(`\nRESULT: FAIL (${failedCount} gate(s) failed: ${failures.join(', ')})`);
  console.error('Re-run the failing gate alone for its full output, e.g.:');
  const first = GATES.find((g) => g.name === failures[0]);
  console.error(`  ${first?.file ? `node ${first.file}` : `npm run ${first?.script ?? 'verify:…'}`}`);
  process.exit(failedCount);
}
console.log('\nRESULT: PASS — every gate is green.');
process.exit(0);
