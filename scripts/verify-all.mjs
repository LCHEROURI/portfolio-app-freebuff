#!/usr/bin/env node
// ============================================================================
// scripts/verify-all.mjs — one-command launch-checklist runner.
//
// Runs every verification gate documented in docs/launch.md §4 sequentially
// against production (or an --app override), so the go-live checklist is
// executable in a single command:
//
//   npm run verify:all                       # all eighteen gates, production URL
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
//   - Reports the onboarding-doc pipeline-diagram presence as its own static
//     summary row: an inline run of the SAME pure check the drift guard runs
//     as [3e/4] (no child process, no secrets, no network — it reads
//     README.md + docs/launch.md from the tree), surfaced beside the 16 gates
//     so the one-command checklist shows the picture's presence at a glance.
//     It is deliberately NOT a GATES/GATE_NAMES entry — adding it there would
//     break the 16-gate §4 contract the drift guard enforces.
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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { crossCheckPipelineDiagrams } from './launch-checklist-gates.mjs';
import { parseSubResultMarkers } from './verify-all-subresults.mjs';

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
const PRODUCTION_URL = 'https://portfolio-app-freebuff--portfolio-app-freebuff2.us-central1.hosted.app';
const ONLY = onlyArg ? onlyArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
const SKIP = skipArg ? skipArg.split(',').map((s) => s.trim()).filter(Boolean) : [];

const GATE_NAMES = ['disk-headroom', 'conv-db', 'cron-reports', 'firestore-rules', 'auth-domains', 'prod-signin', 'google-idp', 'review-sheet', 'deployments', 'deployed-pdf', 'reports-pdf-flow', 'auth-domains-direct', 'deployed-hash', 'import-surface', 'dead-words', 'read-limits'];
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
// URL override (each gate names its own flag: --base for cron-reports, --app
// for the others). `duplicateOf` marks a row that resolves to the same file
// as an earlier gate — it is reported but not re-run.
// Whether a secret is available where the verify scripts read it: the env
// var itself, else .env.local (the same precedence each gate uses internally).
// Mirrors the skip-not-fail convention: a gate whose required secret is absent
// prints the ✗ marker in the summary so the skip is explainable at a glance.
const readSecret = (name) => {
  if (process.env[name]) return true;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    // The m flag anchors ^ per LINE (secrets are not necessarily on line 1).
    return new RegExp(`^${name}=`, 'm').test(env);
  } catch {
    return false;
  }
};

// The REQUIRES cell for a gate: each required secret with a present (✓) or
// absent (✗) marker, plus any non-secret runtime dependency (e.g. Chrome).
const requiresOf = (gate) => {
  const parts = (gate.secrets ?? []).map((s) => `${s} ${readSecret(s) ? '✓' : '✗'}`);
  if (gate.note) parts.push(gate.note);
  return parts.join(', ') || '—';
};

const GATES = [
  // The disk-headroom gate runs FIRST (before every other gate): it checks
  // the LOCAL machine's Data volume use% from df and fails when it exceeds
  // DISK_LIMIT_PCT (default 90) — the disk at 90% is what caused the Freebuff
  // app's SQLite "disk I/O error" on button clicks, and a full disk silently
  // breaks the Chrome /tmp profiles and npm steps every other gate depends
  // on. Skip-not-fail when df is unavailable; DISK_LIMIT_PCT is env-
  // overridable with a numeric guard. Deliberately LOCAL-only: a CI runner's
  // disk is not the developer's, so no ci.yml step runs it — it lives in the
  // pre-push hook (gate 0.05), verify:all, and docs/launch.md §4.
  { name: 'disk-headroom', label: 'Disk headroom', script: 'verify:disk-headroom' },
  // The conv-db gate runs the LOCAL WAL maintainer against the Freebuff
  // conversation DB (the machine's .freebuff/desktop-v2.db, the same DB the
  // app's SQLite "disk I/O error" came from). It reports the maintainer's
  // outcome as sub-rows (wal-idle / wal-truncated / wal-busy / wal-error) so
  // the WAL health shows in the launch-checklist summary; those rows carry the
  // '(local)' suffix because this check is a local-machine probe, not a
  // deployed-app gate. Like disk-headroom, it is deliberately LOCAL-only — a
  // CI runner's DB is not the developer's — so no ci.yml step runs it.
  { name: 'conv-db', label: 'Conv DB WAL maintenance (local)', file: 'scripts/maintain-conv-db.mjs', capture: true, subSuffix: '(local)' },
  // capture: the gate emits VERIFY-SUBRESULT markers for its internal
  // sub-checks — the auth/secret/body/envelope steps in verify-cron-reports,
  // the write/read + cross-user checks in verify-firestore-rules, the
  // authgate/provider-ui/IdP/release/sync steps in verify-prod-signin, the
  // SDK surface + admin config in verify-google-idp, the token-active +
  // and the expect/alias-drift rows in verify-deployed-hash. The runner
  // parses them off the piped stdout and renders each as its own indented
  // row in the summary table, so a sub-contract is visible at a glance
  // instead of being buried in the gate's full output.
  { name: 'cron-reports', label: 'Cron report bodies', script: 'verify:cron-reports', baseFlag: '--base', secrets: ['CRON_SECRET'], capture: true },
  { name: 'firestore-rules', label: 'Firestore rules isolation', script: 'verify:firestore-rules', secrets: ['VERIFY_FIREBASE_PROJECT_ID', 'VERIFY_FIREBASE_WEB_API_KEY'], capture: true },
  { name: 'auth-domains', label: 'Authorized domains', script: 'verify:auth-domains', appFlag: '--app', secrets: ['FIREBASE_WEB_API_KEY'] },
  { name: 'prod-signin', label: 'Production sign-in + Firestore sync', script: 'verify:prod-signin', appFlag: '--app', secrets: ['FIREBASE_WEB_API_KEY', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'], note: 'Chrome', capture: true },
  { name: 'google-idp', label: 'Google IdP record', script: 'verify:google-idp', secrets: ['FIREBASE_WEB_API_KEY', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'], capture: true },
  // The review-sheet gate drives the DEPLOYED Model Comparison page end to
  // end: seeds a live fixture under a throwaway user, generates two AI winner
  // recommendations, opens the Print-all review sheet in the preview window,
  // and asserts BOTH numbered entries render with the friendly model label.
  // Same credential family as prod-signin (web API key to mint the throwaway
  // user + service account to seed the fixture) plus Chrome.
  { name: 'review-sheet', label: 'Review-sheet print-all (deployed)', script: 'verify:review-sheet', appFlag: '--app', secrets: ['FIREBASE_WEB_API_KEY', 'FIREBASE_SERVICE_ACCOUNT', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'], note: 'Chrome', capture: true },
  // The deployments gate proves the DEPLOYED /api/deployments feed end to
  // end with a throwaway Identity Toolkit user (minted from the web API key,
  // deleted after): unauthenticated calls get 401, and at least one Firebase
  // Hosting row AND one Firebase App Hosting row are present with HEALTHY
  // health checks — the app now serves from App Hosting, so the feed must
  // surface its rollouts. Same credential family as prod-signin (web API
  // key).
  { name: 'deployments', label: 'Deployments feed (Firebase Hosting + App Hosting)', script: 'verify:deployments', appFlag: '--app', secrets: ['FIREBASE_WEB_API_KEY'], capture: true },
  // The deployed-pdf gate proves the DEPLOYED /api/print/pdf renders a real
  // PDF AS THE REAL OWNER: a service-account-minted custom token for
  // REPORT_OWNER_ID is exchanged for an idToken, and the authenticated POST
  // must return 200 + application/pdf + a %PDF- body + an attachment
  // filename. This is the contract that 503'd on Vercel (no Chrome binary,
  // untraced chromium.br, no /dev/shm) — a silent regression fails CI. The
  // owner session needs the SA (custom-token mint) + web API key (exchange)
  // + the owner uid, so all three are declared secrets.
  { name: 'deployed-pdf', label: 'Deployed PDF route (serverless Chromium)', script: 'verify:deployed-pdf', appFlag: '--app', secrets: ['FIREBASE_WEB_API_KEY', 'FIREBASE_SERVICE_ACCOUNT', 'REPORT_OWNER_ID'], capture: true },
  // The reports-pdf-flow gate proves the FULL UI download path (not just the
  // API): the owner session is injected into headless Chrome, /reports
  // renders, the REAL "Download PDF" button is clicked, and the browser-level
  // download is captured via CDP and asserted to be a real %PDF- file — so a
  // regression in the button wiring, the auth facade, or the blob/anchor save
  // fails CI even though the API is healthy. Needs Chrome (Linux runner
  // installs it) + the same owner-session trio as deployed-pdf.
  { name: 'reports-pdf-flow', label: 'Reports Download PDF (full UI click-through)', script: 'verify:reports-pdf-flow', appFlag: '--app', secrets: ['FIREBASE_WEB_API_KEY', 'FIREBASE_SERVICE_ACCOUNT', 'REPORT_OWNER_ID'], capture: true },
  { name: 'auth-domains-direct', label: 'Authorized domains (direct script)', file: 'scripts/verify-auth-domains.mjs', appFlag: '--app', duplicateOf: 'auth-domains', secrets: ['FIREBASE_WEB_API_KEY'] },
  { name: 'deployed-hash', label: 'Deployed commit matches expected', script: 'verify:deployed-hash', expectFlag: '--expect', url: PRODUCTION_URL, capture: true },
  // Pure static lint over scripts/ + lib/ + app/: re-exported or unused
  // imports fail the run. No secrets, no network, near-instant — it always
  // runs (the REQUIRES column shows —). Also wired into the pre-push hook
  // (gate 0.6), npm run lint, and CI's lint step.
  { name: 'import-surface', label: 'Import-surface lint (scripts + lib + app)', script: 'verify:import-surface' },
  // Static guard that the removed dead-feature phrasing stays gone: any
  // source file, doc, or config comment that reintroduces the old report-email
  // wording or a removed integration name or env identifier fails the run (the
  // exact banned phrases live in the linter). No secrets, no network — always
  // runs. Wired into the pre-push hook (gate 0.6b), npm run lint, and CI's
  // lint step.
  { name: 'dead-words', label: 'Dead-feature lint (report-email + removed integrations)', script: 'verify:dead-words' },
  // Static guard that the Firestore read-budget fix stays in place: the
  // activity feed must still read newest-first with limit(200) and reports
  // with limit(60) (the exact store-mirroring caps in lib/firestore.ts) — the
  // bounds that keep a full suite + CI day under the Spark 50k-read daily
  // budget. A future edit that unbounds either feed (drops the orderBy or the
  // limit, or routes the collection through the unbounded listAll helper)
  // fails the run. No secrets, no network — always runs. Wired into npm run
  // lint and CI's lint step.
  { name: 'read-limits', label: 'Firestore bounded-read limits (static)', script: 'verify:read-limits' },
];

// ── Self-check: the 16-gate contract must hold before anything runs ─────────
// The launch-checklist contract promises EXACTLY eighteen gates — the same
// EXPECTED_GATE_COUNT verify-launch-checklist.mjs hardcodes. If a future gate
// is added to GATE_NAMES (or a GATES entry to the table) without the full
// contract update — the §4 row + Requires cell, the README/launch.md pipeline
// diagrams, the contract tests, and the drift guard's own constant — this
// check fails LOUDLY right here, before the preflight spawn or any gate
// executes, instead of silently widening the table and reporting a green run
// off a contract that no longer holds. The preflight drift guard would also
// catch the mismatch, but only after spawning a child process; this is
// instant and names the exact source of truth.
const EXPECTED_GATE_COUNT = 16;
if (GATE_NAMES.length !== EXPECTED_GATE_COUNT || GATES.length !== GATE_NAMES.length) {
  console.error(`✗ FAIL: gate contract — GATE_NAMES has ${GATE_NAMES.length}, GATES has ${GATES.length}, but the launch-checklist contract promises ${EXPECTED_GATE_COUNT}.`);    console.error('  A gate was added without the full contract update:');
    console.error('    - scripts/verify-launch-checklist.mjs  EXPECTED_GATE_COUNT');
    console.error('    - docs/launch.md §4 row + Requires cell');
    console.error('    - README.md + docs/launch.md pipeline diagrams');
    console.error('    - the launch-checklist / readme-handoff / ci-workflows contract tests');
    console.error('    - scripts/verify-all.test.ts  (the live-tree lock that pins 12 entries)');
    console.error('  Update every surface together, then re-run.');
  process.exit(2);
}

// Sub-result labels live in verify-all-subresults.mjs alongside the marker
// parser, so the friendly-name map and the regex contract are unit-tested in
// one place (see scripts/verify-all.test.ts).

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
  // capture gates pipe stdout so the runner can scan for VERIFY-SUBRESULT
  // markers while still forwarding it live; everything else inherits stdio.
  const capture = Boolean(gate.capture);
  const child = spawn(cmd, cmdArgs, {
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
  });
  let captured = '';
  if (capture) {
    child.stdout.on('data', (d) => { process.stdout.write(d); captured += d; });
    child.stderr.on('data', (d) => process.stderr.write(d));
  }
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
  const subs = capture
    ? parseSubResultMarkers(captured, gate.name, undefined, gate.subSuffix)
    : [];
  // A capture gate that ran but reported every sub-check as SKIP (e.g. the
  // rules gate while the sandbox Auth is unprovisioned) is a LOUD SKIP, not a
  // pass: the parent row renders SKIPPED (and the sub-row names the reason)
  // so the summary can never be read as a green check. The override only
  // masks a genuinely green exit — a nonzero exit still records a failure
  // and the sub-rows still render.
  const allSkipped = subs.length > 0 && subs.every((s) => s.pass === 'skip');
  results.push({ gate, pass: allSkipped && pass ? 'skip' : pass, timedOut, ms });

  // Sub-result rows: parse any VERIFY-SUBRESULT|<name>|<PASS|FAIL|SKIP>
  // markers the gate emitted and surface each as its own row directly under
  // the parent gate's row. Only rows with a real marker are added — a gate
  // that fails before emitting its markers contributes nothing extra (its own
  // FAIL row already tells the story). The parent gate's exit code still
  // governs pass/fail for the whole run; the sub-row is visibility, not a
  // second gate.
  for (const sub of subs) {
    results.push({
      gate: { name: sub.name, label: sub.label, secrets: [], sub: true },
      pass: sub.pass,
      timedOut: false,
      ms: 0,
      sub: true,
    });
  }
};

// ── Preflight: the doc's gates must be runnable before we run any ───────────
console.log(`\nLaunch checklist runner — ${APP || 'production URL (default)'}\n`);
console.log('[0/12] Preflight: launch-checklist drift guard');
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

// ── Static companion row: onboarding-doc pipeline-diagram presence ──────────
// The drift guard's [3e/4] step already fails the preflight when either
// onboarding doc loses the "When each gate runs:" picture. This inline run of
// the SAME pure check — no child process, no secrets, no network — surfaces
// the picture's presence as its own summary row beside the 16 gates, so the
// one-command checklist reports it at a glance instead of only in the
// preflight's scrollback. Failures flow through the shared failures array, so
// a missing picture fails the whole run even if [3e/4] were ever weakened.
const pipelineDiagramStart = Date.now();
const pictureFailures = crossCheckPipelineDiagrams({
  readmeSrc: readFileSync(resolve(process.cwd(), 'README.md'), 'utf8'),
  launchSrc: readFileSync(resolve(process.cwd(), 'docs/launch.md'), 'utf8'),
});
console.log('\n── ▶ Onboarding-doc pipeline diagram presence (static)');
for (const msg of pictureFailures) console.error(`  ✗ ${msg}`);
const picturePass = pictureFailures.length === 0;
if (!picturePass) failures.push('pipeline-diagram');
results.push({
  gate: { name: 'pipeline-diagram', label: 'Onboarding-doc pipeline diagram presence', secrets: [], static: true },
  pass: picturePass,
  timedOut: false,
  ms: Date.now() - pipelineDiagramStart,
});

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
  : r.pass === 'skip' ? 'SKIPPED'
  : r.pass ? 'PASS'
  : r.timedOut ? `TIMEOUT (${TIMEOUT_SEC}s)`
  : 'FAIL';
const w = Math.max(...results.map((r) => r.gate.label.length), 'GATE'.length);
const rw = Math.max(...results.map((r) => requiresOf(r.gate).length), 'REQUIRES'.length);
console.log(`  ${pad('GATE', w)}  ${pad('STATUS', 7)}  ${pad('REQUIRES', rw)}  TIME`);
console.log(`  ${'-'.repeat(w)}  -------  ${'-'.repeat(rw)}  -----`);
for (const r of results) {
  const time = r.pass === null || r.pass === 'covered' || r.pass === 'skip' || r.sub ? '—' : `${(r.ms / 1000).toFixed(1)}s`;
  console.log(`  ${pad(r.gate.label, w)}  ${pad(statusOf(r), 7)}  ${pad(requiresOf(r.gate), rw)}  ${time}`);
}
console.log('══════════════════════════════════════════════════════════');  console.log('  ✓ = secret present (env or .env.local) · ✗ = missing — most gates');
  console.log('  skip-not-fail internally, so check the REQUIRES column first.');

// The always-present static picture row is a companion check, not a gate: it
// must not satisfy the no-gates-ran guard, so --skip of every gate still
// exits 2 instead of reporting PASS off the picture row alone.
const ranCount = results.filter((r) => r.pass !== null && r.pass !== 'covered' && !r.gate.static).length;
if (ranCount === 0) {
  console.error('\nRESULT: FAIL — no gates ran (--only/--skip filtered everything out).');
  process.exit(2);
}

const failedCount = failures.length;
if (failedCount > 0) {
  console.error(`\nRESULT: FAIL (${failedCount} gate(s) failed: ${failures.join(', ')})`);
  console.error('Re-run the failing gate alone for its full output, e.g.:');
  if (failures[0] === 'pipeline-diagram') {
    // The picture row is a static companion, not a GATES entry — the failing
    // "gate" is the drift guard itself (its [3e/4] step runs the same check).
    console.error('  node scripts/verify-launch-checklist.mjs   (drift guard [3e/4])');
  } else {
    const first = GATES.find((g) => g.name === failures[0]);
    console.error(`  ${first?.file ? `node ${first.file}` : `npm run ${first?.script ?? 'verify:…'}`}`);
  }
  process.exit(failedCount);
}
console.log('\nRESULT: PASS — every gate is green.');
process.exit(0);
