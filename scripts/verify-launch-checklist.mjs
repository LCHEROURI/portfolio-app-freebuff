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
//
// Also enforces the doc's "eleven gates" claim: if §4 stops listing one of the
// gates, or a new gate is added to the doc without a matching script, this
// check fails — so the checklist can never drift from the runnable commands.
//
// Exit nonzero on any mismatch. No secrets, no network, pure static check —
// safe to run on every push and PR.
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

const DOC = 'docs/launch.md';
const GATE_SECTION_HEADING = /^## \d+\. The verification gates/;
const EXPECTED_GATE_COUNT = 11;
// The exact canonical commands §4 must document. Hardcoding the set (not just
// the count) closes the silent-drift hole: deleting a real gate while adding
// a different row would keep the count at 8 but fail here. The deployed-hash
// row is documented WITH its --expect argument (that is the gate form the
// pre-push hook and CI use); the parser tolerates trailing args on npm gates.
const EXPECTED_GATES = [
  'npm run verify:cron-email',
  'npm run verify:firestore-rules',
  'npm run verify:auth-domains',
  'node scripts/verify-prod-signin.mjs',
  'node scripts/verify-google-idp.mjs',
  'npm run verify:token-health',
  'npm run verify:vercel-env',
  'npm run verify:resend',
  'node scripts/verify-auth-domains.mjs',
  'npm run verify:deployed-hash -- --expect <sha>',
  'npm run verify:import-surface',
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

console.log(`\n[1/3] Parsing gate table from ${DOC}`);
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
console.log('\n[2/3] Cross-referencing against package.json scripts');
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

console.log('\n[3/3] Summary');
if (failures.length > 0) {
  console.error(`RESULT: FAIL (${failures.length})`);
  console.error(`\n${DOC} §4 promises commands the repo cannot run. Fix the doc or add the missing scripts above.`);
  process.exit(1);
}
console.log(`All ${EXPECTED_GATE_COUNT} gates in ${DOC} §4 are runnable from package.json.`);
console.log('RESULT: PASS');
