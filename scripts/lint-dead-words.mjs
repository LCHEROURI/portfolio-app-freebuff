#!/usr/bin/env node
// ============================================================================
// scripts/lint-dead-words.mjs — static guard against dead-feature wording
// returning to the repo.
//
// Removed features must stay removed — not just the behavior, but the words.
// Two families of dead-feature phrasing fail the lint if they ever reappear:
//
//   1. The emailed-report feature was removed: the cron composes daily/weekly
//      report bodies that feed the in-app Reports page, and nothing is
//      emailed. Any source file, doc, or config comment that reintroduces the
//      report-email phrasing fails:
//        cron-email             — the renamed gate (verify:cron-reports)
//        emailed reports        — reports are composed, not emailed
//        email body             — the composed text is a report body
//        email preview          — the preview is a report preview
//        emails (you|daily|weekly) — the verb form of emailing reports
//        emailed (daily|weekly)    — the past-tense form
//
//   2. The dead integrations were removed with their features: the old
//      Postgres data store (Supabase) and the email sender (Resend), plus
//      their env identifiers (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
//      RESEND_API_KEY / REPORT_EMAIL / REPORT_FROM). Those names may never
//      come back either — no card, no status check, no "no longer needed"
//      note, no comment.
//
// The sweep is deliberately line-based (a regex per line), not an AST pass:
// these are prose phrases in comments and docs, so exact substring matching
// is the right tool — unlike the import-surface lint, where only the TS
// compiler can tell a real identifier from a doc-comment mention.
//
// Deliberate exclusions (the same boundaries the removal honored):
//   - docs/reviews/      — dated historical review records describe the
//     feature as it existed when the review was written; rewriting them would
//     falsify history. They are skipped, not edited.
//   - this file + its test — the banned-phrase list below and the test
//     fixtures must quote the phrasing by definition; skipping them is
//     standard self-exclusion (every linter contains the patterns it
//     detects). Locked by a dedicated test.
//   - auth email         — sign-in identity identifiers (email/password,
//     sendPasswordReset, user.email) never match the report-phrase patterns
//     below, so they are naturally clean; the exclusion is coincidental, not
//     a carve-out. A comment that uses the verb forms about auth (e.g. "the
//     sign-in flow emails you a link") is still flagged — reword it.
//   - the removed-var LOCK — lib/integrationVarLinks.test.ts asserts that the
//     removed env identifiers (SUPABASE_URL, RESEND_API_KEY, REPORT_EMAIL,
//     REPORT_FROM) resolve to null. Those call lines MUST quote the dead
//     names to prove they are gone — exactly the lines invoking the lock
//     helpers (varSourceUrl / varEnvLine / firstVarSource) are exempt, so the
//     lock stays meaningful while no OTHER mention of the names survives.
//     Locked by a dedicated test.
//
// Scans scripts/, lib/, app/, docs/ (minus docs/reviews/), .github/, and
// .githooks/ recursively for .mjs / .ts / .tsx / .md / .sh / .yml / .yaml /
// .json files, plus the root README.md and .env.example. Extensionless files
// (e.g. the .githooks/pre-push hook itself) are not swept by design — the
// hook's own comments quote the phrases for illustration. Exits 1 with the
// offending file:line when any banned phrase is found; prints a clean message
// and exits 0 otherwise.
//
// Usage:
//   node scripts/lint-dead-words.mjs
//   npm run lint                     # next lint, then this after import-surface
//   npm run verify:dead-words       # standalone
//
// Exports (for the unit test): auditSource, scanDir, scanRoots, main.
// Read-only against the working tree.
// ============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = process.cwd();
const DEFAULT_ROOTS = ['scripts', 'lib', 'app', 'docs', '.github', '.githooks'];
const ROOT_FILES = ['README.md', '.env.example'];
// Same extension family the import-surface lint uses, plus prose carriers.
const SCAN_EXT = /\.(mjs|js|ts|tsx|md|sh|yml|yaml|json)$/;
// Skipped as directories while walking (plus node_modules/.next handled below).
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.freebuff', 'reviews']);
// Historical review records are snapshots of the past — never swept.
const SKIP_SUBTREE = 'docs/reviews';
// The linter itself and its test must quote the banned phrases (the list
// below and the planted fixtures). Excluded so the sweep stays green; locked
// by a dedicated test in lint-dead-words.test.ts.
const SELF_FILES = new Set([
  'scripts/lint-dead-words.mjs',
  'scripts/lint-dead-words.test.ts',
]);

// The removed-var LOCK: integrationVarLinks.test.ts quotes the dead env
// identifiers to assert they resolve to null. Exactly the helper-call
// STATEMENT lines are exempt — the trimmed line must start with expect( (or
// return) AND contain a lock-helper token. A prose comment that happens to
// mention a helper name on the same line is still flagged. Everywhere else in
// the file (and every other file), the names fail the lint.
const LOCK_FILE = 'lib/integrationVarLinks.test.ts';
const LOCK_HELPER_CALL = /varSourceUrl\(|varEnvLine\(|firstVarSource\(/;
const LOCK_STATEMENT = /^\s*(?:expect\(|return\s)/;

// Case-insensitive prose phrases that describe removed features (report email
// + dead integrations). Each entry names the human wording it catches; the
// regex is applied per line.
const BANNED_PHRASES = [
  // 1. The removed report-email flow.
  { phrase: 'cron-email', re: /cron-email/i },
  { phrase: 'emailed report(s)', re: /emailed\s+reports?/i },
  { phrase: 'email body', re: /email\s+bod(y|ies)/i },
  { phrase: 'email preview', re: /email\s+preview/i },
  { phrase: 'emails (you|daily|weekly)', re: /emails\s+(you|daily|weekly)/i },
  { phrase: 'emailed (daily|weekly)', re: /emailed\s+(daily|weekly)/i },
  // 2. The dead integrations (Supabase data store + Resend sender) and their
  //    env identifiers.
  { phrase: 'supabase', re: /supabase/i },
  { phrase: 'SUPABASE_URL', re: /SUPABASE_URL/i },
  { phrase: 'SUPABASE_SERVICE_ROLE_KEY', re: /SUPABASE_SERVICE_ROLE_KEY/i },
  { phrase: 'resend', re: /resend/i },
  { phrase: 'RESEND_API_KEY', re: /RESEND_API_KEY/i },
  { phrase: 'REPORT_EMAIL', re: /REPORT_EMAIL/i },
  { phrase: 'REPORT_FROM', re: /REPORT_FROM/i },
];

/**
 * Audit one file's text for banned dead-feature phrasing.
 * Returns an array of { line, phrase } — empty when clean.
 * The removed-var LOCK file's helper-call lines are exempt (see header).
 */
export function auditSource(source, fileName = 'file') {
  const findings = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const { phrase, re } of BANNED_PHRASES) {
      if (!re.test(line)) continue;
      // Lock exemption: the integrationVarLinks test must quote the dead env
      // identifiers inside its lock helpers to prove they resolve to null.
      // Scoped to real helper-call statements, so a prose comment that merely
      // mentions a helper name on the same line is still flagged.
      if (fileName === LOCK_FILE && LOCK_STATEMENT.test(line) && LOCK_HELPER_CALL.test(line)) continue;
      findings.push({ line: i + 1, phrase });
    }
  }
  return findings;
}

/** Recursively list scannable files under a root, skipping ignored dirs. */
function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue; // unreadable / missing — skip
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const p = resolve(dir, entry);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        // docs/reviews is a dated historical record — skip the subtree.
        if (relative(REPO_ROOT, p).startsWith(SKIP_SUBTREE)) continue;
        stack.push(p);
      } else if (SCAN_EXT.test(entry)) {
        // File-level guard too: scanning the skip subtree directly (as the
        // historical-records test does) must never report its files.
        if (relative(REPO_ROOT, p).startsWith(SKIP_SUBTREE)) continue;
        out.push(p);
      }
    }
  }
  return out.sort();
}

/**
 * Scan one root recursively (or a single file path). Returns findings with the
 * repo-relative file path attached, in deterministic order.
 */
export function scanDir(root) {
  const findings = [];
  const files = walkFiles(root);
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    // Self-exclusion: the linter's own file and its test plant the phrases.
    if (SELF_FILES.has(rel)) continue;
    const source = readFileSync(file, 'utf8');
    for (const finding of auditSource(source, rel)) {
      findings.push({ file: rel, ...finding });
    }
  }
  return findings;
}

/**
 * Scan every default root plus the root-level prose files.
 * Hard-fails if a root is missing, so running from the wrong cwd can never
 * silently produce a clean (false) scan.
 */
export function scanRoots(roots = DEFAULT_ROOTS) {
  const findings = [];
  for (const root of roots) {
    const resolved = resolve(REPO_ROOT, root);
    try {
      statSync(resolved);
    } catch {
      throw new Error(`lint-dead-words: root not found: ${resolved} — run from the repo root`);
    }
    findings.push(...scanDir(resolved));
  }
  for (const file of ROOT_FILES) {
    const resolved = resolve(REPO_ROOT, file);
    try {
      statSync(resolved);
    } catch {
      continue; // optional root prose file — README/.env.example may be absent
    }
    const source = readFileSync(resolved, 'utf8');
    for (const finding of auditSource(source, file)) {
      findings.push({ file, ...finding });
    }
  }
  return findings;
}

export function main(roots = DEFAULT_ROOTS) {
  let findings;
  try {
    findings = scanRoots(roots);
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  if (findings.length === 0) {
    console.log('lint-dead-words: clean — no dead-feature phrasing found (see the banned list in this file).');
    return 0;
  }
  console.error('lint-dead-words: FAIL');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} — banned phrase "${f.phrase}"`);
  }
  console.error('Removed features stay removed — reword to drop the dead-feature language.');
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(DEFAULT_ROOTS);
}
