#!/usr/bin/env node
// ============================================================================
// scripts/verify-launch-checklist.mjs — launch-checklist drift guard.
//
// Parses docs/launch.md's §4 "verification gates" table and asserts every
// command it documents is actually runnable from this repo:
//
//   - `npm run <name>`    → package.json must define a script named <name>,
//                           and that script's target file must exist on disk.
//   - `node scripts/X`    → the file must exist AND be aliased by a
//                           package.json script (so it is runnable the same
//                           canonical way every other gate is).
//   - the §4 gate names   → must EXACTLY match scripts/verify-all.mjs's
//     GATE_NAMES / GATES arrays (the runner that executes the checklist). A
//     gate renamed, dropped, or added in the runner without a matching §4
//     change fails here, even when the doc and package.json stay runnable.
//   - the pipeline picture → BOTH onboarding docs (README.md's handoff
//     section and this doc's §4) must still carry the "When each gate runs:"
//     pipeline-diagram section, so the picture itself is contract-locked in
//     CI — not just asserted by the vitest suite that checks its content.
//
// Also enforces the doc's "eighteen gates" claim: if §4 stops listing one of the
// gates, or a new gate is added to the doc without a matching script, this
// check fails — so the checklist can never drift from the runnable commands.
//
// Exit nonzero on any mismatch. No secrets, no network, pure static check —
// safe to run on every push and PR.
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { crossCheckCiGates, crossCheckDeploymentStatusGates, crossCheckPipelineDiagrams, crossCheckSystemInjectedVars, crossCheckVerifyAllGates, crossCheckVerifyAllSecrets, parseLaunchChecklistTable } from './launch-checklist-gates.mjs';

const ROOT = process.cwd();

const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

const DOC = 'docs/launch.md';
const README = 'README.md';
const VERIFY_ALL = 'scripts/verify-all.mjs';
const CI = '.github/workflows/ci.yml';
const GATE_SECTION_HEADING = /^## \d+\. The verification gates/;
const EXPECTED_GATE_COUNT = 18;
// The exact canonical commands §4 must document. Hardcoding the set (not just
// the count) closes the silent-drift hole: deleting a real gate while adding
// a different row would keep the count at 8 but fail here. The deployed-hash
// row is documented WITH its --expect argument (that is the gate form the
// pre-push hook and CI use); the parser tolerates trailing args on npm gates.
const EXPECTED_GATES = [
  'npm run verify:disk-headroom',
  'node scripts/maintain-conv-db.mjs',
  'npm run verify:cron-reports',
  'npm run verify:firestore-rules',
  'npm run verify:auth-domains',
  'node scripts/verify-prod-signin.mjs',
  'node scripts/verify-google-idp.mjs',
  'npm run verify:review-sheet',
  'npm run verify:deployments',
  'npm run verify:deployed-pdf',
  'npm run verify:reports-pdf-flow',
  'npm run verify:token-health',
  'npm run verify:vercel-env',
  'node scripts/verify-auth-domains.mjs',
  'npm run verify:deployed-hash -- --expect <sha>',
  'npm run verify:import-surface',
  'npm run verify:dead-words',
  'npm run verify:read-limits',
  // NOTE: the deployed-hash row above keeps the literal "<sha>" placeholder
  // ON PURPOSE — the exact-set check matches this string verbatim against the
  // doc row, so the doc must stay in this documented form (a real sha or
  // --expect=<sha> syntax in the doc would fail the guard by design, forcing
  // the guard to be updated too).
];

const doc = read(DOC);
const pkg = JSON.parse(read('package.json'));

const failures = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { failures.push(msg); console.error(`  ✗ ${msg}`); };

// ── 1. Extract the §4 gate table ────────────────────────────────────────────
const lines = doc.split('\n');
const startIdx = lines.findIndex((l) => GATE_SECTION_HEADING.test(l.trim()));
if (startIdx < 0) {
  console.error(`✗ FAIL: ${DOC} has no "The verification gates" section heading.`);
  process.exit(1);
}
// The gate table is bounded to this section: only the rows between this
// heading and the next "## " section heading are candidates, so a backticked
// table added anywhere later in the doc can never be misread as a gate (and a
// deleted gate can never be silently replaced by one).
const nextSection = lines.slice(startIdx + 1).findIndex((l) => /^## /.test(l));
const sectionLines = nextSection >= 0
  ? lines.slice(startIdx + 1, startIdx + 1 + nextSection)
  : lines.slice(startIdx + 1);
const tableRows = sectionLines
  .filter((l) => /^\|\s*`[^`]+`/.test(l));

const gates = tableRows
  .map((row) => {
    const m = row.match(/^\|\s*`([^`]+)`/);
    return m ? m[1] : null;
  })
  .filter((x) => Boolean(x));

console.log(`\n[1/4] Parsing gate table from ${DOC}`);
console.log(`  found ${gates.length} gate command(s) in §4`);
gates.forEach((g) => console.log(`    - ${g}`));

if (gates.length !== EXPECTED_GATE_COUNT) {
  fail(
    `§4 documents ${gates.length} gates but the doc promises ${EXPECTED_GATE_COUNT}. `
    + `Add or remove rows so the table lists exactly ${EXPECTED_GATE_COUNT}.`,
  );
}

// Exact-set check: every canonical gate must be present by its documented
// command, and no unknown command may sneak into the table. This is what makes
// the guard tamper-proof — the count alone can be gamed by swap.
const missing = EXPECTED_GATES.filter((g) => !gates.includes(g));
if (missing.length > 0) {
  fail(`§4 is missing expected gate(s): ${missing.join(', ')}`);
}
const unexpected = gates.filter((g) => !EXPECTED_GATES.includes(g));
if (unexpected.length > 0) {
  fail(`§4 documents unexpected gate command(s): ${unexpected.join(', ')}`);
}

// ── 2. Resolve the canonical scripts/ target of every npm script ────────────
// For `npm run <name>` gates we need the underlying file; for
// `node scripts/X` gates we need the npm alias that runs it.
const npmScripts = pkg.scripts ?? {};

const scriptTargetFile = (value) => {
  const m = String(value).match(/scripts\/[\w./-]+\.(mjs|ts|js|sh|cjs)\b/);
  return m ? m[0] : null;
};

// Map "scripts/foo.mjs" → [npm names that run it], so a `node scripts/…`
// gate can be checked for a canonical alias.
const aliasesByFile = new Map();
for (const [name, value] of Object.entries(npmScripts)) {
  const target = scriptTargetFile(value);
  if (target) {
    const list = aliasesByFile.get(target) ?? [];
    list.push(name);
    aliasesByFile.set(target, list);
  }
}

// ── 3. Assert every gate is runnable ────────────────────────────────────────
console.log('\n[2/4] Cross-referencing against package.json scripts');
for (const gate of gates) {
  const npm = gate.match(/^npm run (\S+)(?:\s+.*)?$/);
  if (npm) {
    const name = npm[1];
    const value = npmScripts[name];
    if (!value) {
      fail(`"${gate}" — package.json has no "${name}" script. Add it so the checklist stays runnable.`);
      continue;
    }
    const target = scriptTargetFile(value);
    if (target && !existsSync(resolve(ROOT, target))) {
      fail(`"${gate}" → script "${name}" points at missing file "${target}".`);
      continue;
    }
    ok(`"${gate}" → script "${name}"${target ? ` (${target})` : ''}`);
    continue;
  }

  const node = gate.match(/^node (scripts\/[\w./-]+\.mjs)$/);
  if (node) {
    const file = node[1];
    if (!existsSync(resolve(ROOT, file))) {
      fail(`"${gate}" — file "${file}" does not exist.`);
      continue;
    }
    const aliases = aliasesByFile.get(file) ?? [];
    if (aliases.length === 0) {
      fail(`"${gate}" — no package.json script aliases "${file}". Add a script so it runs canonically.`);
      continue;
    }
    ok(`"${gate}" → file exists, aliased by npm script(s): ${aliases.join(', ')}`);
    continue;
  }

  fail(`"${gate}" — unsupported command form in the gate table (expected "npm run <name>" or "node scripts/<file>.mjs").`);
}

// ── 3. Cross-check §4 gate names against verify-all.mjs ─────────────────────
// package.json runnability alone can't see a gate RENAMED or DROPPED in the
// runner: both stores can stay internally consistent while the doc and the
// runner disagree about what exists. The pure cross-check resolves every §4
// command to the gate name verify-all.mjs uses and asserts the sets match.
console.log('\n[3/4] Cross-referencing §4 gate names against verify-all.mjs');
const verifyAllSrc = read(VERIFY_ALL);
const crossFailures = crossCheckVerifyAllGates({
  docCommands: gates,
  verifyAllSrc,
  npmScripts,
  expectedCount: EXPECTED_GATE_COUNT,
});
for (const msg of crossFailures) fail(msg);
if (crossFailures.length === 0) {
  ok(`§4 gate names exactly match verify-all.mjs GATE_NAMES (${EXPECTED_GATE_COUNT})`);
}

// Every §4 row must also carry its secrets requirement (the Requires column
// verify-all.mjs's summary table prints). The cross-check asserts the doc's
// Requires cells exactly match each gate's `secrets` array in the runner, so
// a secret added to the runner without a doc update fails here.
console.log('\n[3b/4] Cross-referencing §4 Requires column against verify-all.mjs secrets');
// Note: the drift guard already declares `tableRows` for its own §4 parsing;
// the secrets parser's rows get a distinct name to avoid shadowing.
const { header: requiresHeader, rows: requiresRows } = parseLaunchChecklistTable(doc);
const secretsFailures = crossCheckVerifyAllSecrets({
  rows: requiresRows,
  header: requiresHeader,
  verifyAllSrc,
  npmScripts,
});
for (const msg of secretsFailures) fail(msg);
if (secretsFailures.length === 0) {
  ok('every §4 gate row carries the exact secrets verify-all.mjs declares (Requires column)');
}

// CI's post-deploy jobs must gate each verify step on secrets the runner
// actually declares for that gate — so the doc, the runner, and CI can never
// disagree about what a gate needs: a step gated on a secret the runner never
// declared, or run ungated while its gate declares secrets, fails here.
console.log('\n[3c/4] Cross-referencing ci.yml gating against verify-all.mjs secrets');
const ciSrc = read(CI);
const ciFailures = crossCheckCiGates({ ciSrc, verifyAllSrc, npmScripts });
for (const msg of ciFailures) fail(msg);
if (ciFailures.length === 0) {
  ok('every ci.yml verify step is gated on secrets verify-all.mjs declares for its gate (both directions)');
}

// The deployment_status workflows (gallery / preview-gate / deployed-hash)
// fire on Vercel's deployment_status event, NOT on push — so they are
// invisible to the ci.yml parser above. The same credential contract applies:
// each workflow is mapped to the gate whose credentials it exercises
// (gallery + deployed-hash → deployed-hash's VERCEL_TOKEN; preview-gate →
// auth-domains' FIREBASE_WEB_API_KEY), every gated secret must be declared by
// that gate, and every secret the mapped gate declares must actually be gated
// somewhere in the workflow.
console.log('\n[3d/4] Cross-referencing deployment_status workflow gating against verify-all.mjs secrets');
const DEPLOYMENT_STATUS_WORKFLOWS = [
  { name: 'gallery', gate: 'deployed-hash', src: read('.github/workflows/gallery.yml') },
  { name: 'preview-gate', gate: 'auth-domains', src: read('.github/workflows/preview-gate.yml') },
  { name: 'verify-deployed-hash', gate: 'deployed-hash', src: read('.github/workflows/verify-deployed-hash.yml') },
];
// Deliberately call the deployment-status check directly (NOT crossCheckCiGates):
// crossCheckCiGates would re-run the full ci.yml step check that [3c/4] just
// reported, printing every ci.yml failure twice on a drift.
const dsFailures = crossCheckDeploymentStatusGates({
  workflows: DEPLOYMENT_STATUS_WORKFLOWS,
  verifyAllSrc,
  npmScripts,
});
for (const msg of dsFailures) fail(msg);
if (dsFailures.length === 0) {
  ok('every deployment_status workflow gates on secrets verify-all.mjs declares for its gate');
}

// The onboarding docs (README.md handoff + docs/launch.md §4) both carry a
// "When each gate runs:" pipeline diagram. The readme-pipeline vitest locks
// the diagram's CONTENT (the five ci.yml job names + three deployment_status
// workflow names); this step locks its PRESENCE in CI — a doc that loses the
// section fails the drift guard on every push, not just the test suite.
console.log('\n[3e/4] Cross-referencing onboarding-doc pipeline-diagram presence');
const diagramFailures = crossCheckPipelineDiagrams({
  readmeSrc: read(README),
  launchSrc: doc,
});
for (const msg of diagramFailures) fail(msg);
if (diagramFailures.length === 0) {
  ok('README.md and docs/launch.md both carry the "When each gate runs:" pipeline diagram');
}

// The vercel-env gate's expectations contract extends beyond credentials to
// the pull-format exemption: its SYSTEM_INJECTED_VARS set (the vars `vercel
// env pull` injects per build — OIDC token, deploy URL, git metadata — whose
// values rotate every commit/deploy) must match the canonical list exactly,
// must never exempt a real project var (VERCEL_TOKEN / VERCEL_TEAM_ID share
// the prefix but stay value-compared), and the §4 vercel-env row must
// document the exemption so the checklist can't silently lose the note.
console.log('\n[3f/4] Cross-referencing verify-vercel-env system-injected-vars exemption');
const systemInjectedFailures = crossCheckSystemInjectedVars({
  vercelEnvSrc: read('scripts/verify-vercel-env.mjs'),
  launchDoc: doc,
  readmeDoc: read('README.md'),
});
for (const msg of systemInjectedFailures) fail(msg);
if (systemInjectedFailures.length === 0) {
  ok('verify-vercel-env.mjs SYSTEM_INJECTED_VARS matches the canonical set and the §4 row documents the exemption');
}

console.log('\n[4/4] Summary');
if (failures.length > 0) {
  console.error(`RESULT: FAIL (${failures.length})`);
  console.error(`\n${DOC} §4 promises commands the repo cannot run. Fix the doc or add the missing scripts above.`);
  process.exit(1);
}
console.log(`All ${EXPECTED_GATE_COUNT} gates in ${DOC} §4 are runnable from package.json.`);
console.log('RESULT: PASS');
