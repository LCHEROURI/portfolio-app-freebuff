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
//   - the SOURCE OF TRUTH — lib/integrationVarLinks.ts exports the
//     REMOVED_ENV_VARS array, and BOTH this sweep's env-identifier phrases
//     and the lock test loop above derive from it. The array-literal lines in
//     that file MUST quote the dead names to define them, so exactly those
//     lines are exempt; every other line in the file is still swept. If the
//     array is missing or empty, the sweep fails loudly instead of silently
//     dropping coverage — the banned list can never drift from the source.
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
//   npm run verify:dead-words        # standalone
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

// The single source of truth for removed env identifiers: lib/integrationVarLinks.ts
// exports REMOVED_ENV_VARS, and the sweep derives its env-identifier banned
// phrases from exactly that array — so the banned list and the lock test
// (which loops the same array) can never drift. The array-literal lines in
// the truth file are exempt (they must quote the dead names to define them).
const TRUTH_FILE = 'lib/integrationVarLinks.ts';
const REMOVED_VARS_RE = /export\s+const\s+REMOVED_ENV_VARS\s*=\s*\[([\s\S]*?)\]\s*(?:as\s+const\s*)?;/;

/** Parse the REMOVED_ENV_VARS array literal out of the truth file's source. */
export function extractRemovedEnvVars(source) {
  const m = source.match(REMOVED_VARS_RE);
  if (!m) {
    throw new Error(`lint-dead-words: REMOVED_ENV_VARS not found in ${TRUTH_FILE} — the sweep derives its env-identifier phrases from it`);
  }
  const names = [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]);
  if (names.length === 0) {
    throw new Error(`lint-dead-words: REMOVED_ENV_VARS in ${TRUTH_FILE} is empty — the source of truth must list the removed identifiers`);
  }
  return names;
}

/** [startLine, endLine] (1-based, inclusive) of the array literal, for exemption. */
export function removedVarsArraySpan(source) {
  const m = source.match(REMOVED_VARS_RE);
  if (!m) return null;
  const startLine = source.slice(0, m.index).split('\n').length;
  return [startLine, startLine + m[0].split('\n').length - 1];
}

/** Turn the truth-file identifiers into case-insensitive banned phrases. */
export const envIdentifierPhrases = (names) =>
  names.map((name) => ({ phrase: name, re: new RegExp(name, 'i') }));

// Case-insensitive prose phrases that describe removed features (report email
// + dead integrations). Each entry names the human wording it catches; the
// regex is applied per line.
// Hardcoded prose phrases: the removed report-email wording plus the generic
// removed-feature names. The env-identifier phrases below are DERIVED from
// lib/integrationVarLinks.ts's REMOVED_ENV_VARS at module load, so adding an
// identifier to the source of truth automatically extends the sweep.
const PROSE_PHRASES = [
  // 1. The removed report-email flow.
  { phrase: 'cron-email', re: /cron-email/i },
  { phrase: 'emailed report(s)', re: /emailed\s+reports?/i },
  { phrase: 'email body', re: /email\s+bod(y|ies)/i },
  { phrase: 'email preview', re: /email\s+preview/i },
  { phrase: 'emails (you|daily|weekly)', re: /emails\s+(you|daily|weekly)/i },
  { phrase: 'emailed (daily|weekly)', re: /emailed\s+(daily|weekly)/i },
  // 2. The generic removed-feature names (the old data store + the sender).
  { phrase: 'supabase', re: /supabase/i },
  { phrase: 'resend', re: /resend/i },
];

// Derived from the source of truth at module load. A missing or empty array
// is a loud failure (TRUTH_ERROR) surfaced by scanRoots — never a silent
// drop in coverage.
let TRUTH_ERROR = null;
let BANNED_ENV_PHRASES = [];
try {
  const truthSource = readFileSync(resolve(REPO_ROOT, TRUTH_FILE), 'utf8');
  BANNED_ENV_PHRASES = envIdentifierPhrases(extractRemovedEnvVars(truthSource));
} catch (err) {
  TRUTH_ERROR = err.message;
}
const BANNED_PHRASES = [...PROSE_PHRASES, ...BANNED_ENV_PHRASES];

/**
 * Audit one file's text for banned dead-feature phrasing.
 * Returns an array of { line, phrase } — empty when clean.
 * The removed-var LOCK file's helper-call lines are exempt (see header).
 */
export function auditSource(source, fileName = 'file') {
  const findings = [];
  const lines = source.split('\n');
  // Source-of-truth exemption: the REMOVED_ENV_VARS array literal lines in
  // lib/integrationVarLinks.ts must quote the dead names to define them. The
  // rest of that file is still swept normally.
  const truthSpan = fileName === TRUTH_FILE ? removedVarsArraySpan(source) : null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (truthSpan && i + 1 >= truthSpan[0] && i + 1 <= truthSpan[1]) continue;
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
  // Loud failure: a missing or empty REMOVED_ENV_VARS source of truth must
  // never silently shrink the sweep. scanRoots is also what the live-clean
  // test calls, so a broken truth file fails the suite instead of passing.
  if (TRUTH_ERROR) {
    throw new Error(`lint-dead-words: ${TRUTH_ERROR}`);
  }
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
