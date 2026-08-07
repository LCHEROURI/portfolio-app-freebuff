#!/usr/bin/env node
// ============================================================================
// scripts/lint-email-words.mjs — static guard against report-email wording
// returning to the repo.
//
// The emailed-report feature was removed: the cron composes daily/weekly
// report bodies that feed the in-app Reports page, and nothing is emailed.
// This linter makes that removal permanent — any source file, doc, or config
// comment that reintroduces the report-email phrasing fails the lint:
//
//   cron-email           — the renamed gate (verify:cron-reports) / script
//   emailed reports      — reports are composed, not emailed
//   email body           — the composed report text is a body, not an email
//   email preview        — the plain-text preview is a report preview
//   emails (you|daily|weekly) — the verb form of emailing reports
//   emailed (daily|weekly)    — the past-tense form of emailing reports
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
//   - env var names      — RESEND_API_KEY / REPORT_EMAIL / REPORT_FROM appear
//     in integrationVarLinks.test.ts as the LOCK that they resolve to null,
//     and in docs as "no longer needed" notes. Those identifiers are not the
//     prose phrasing this guard targets.
//
// Scans scripts/, lib/, app/, docs/ (minus docs/reviews/), .github/, and
// .githooks/ recursively for .mjs / .ts / .tsx / .md / .sh / .yml / .yaml /
// .json files, plus the root README.md and .env.example. Exits 1 with the
// offending file:line when any banned phrase is found; prints a clean message
// and exits 0 otherwise.
//
// Usage:
//   node scripts/lint-email-words.mjs
//   npm run lint                     # next lint, then this after import-surface
//   npm run verify:email-words       # standalone
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
// by a dedicated test in lint-email-words.test.ts.
const SELF_FILES = new Set([
  'scripts/lint-email-words.mjs',
  'scripts/lint-email-words.test.ts',
]);

// Case-insensitive prose phrases that describe the removed report-email flow.
// Each entry names the human wording it catches; the regex is applied per line.
const BANNED_PHRASES = [
  { phrase: 'cron-email', re: /cron-email/i },
  { phrase: 'emailed report(s)', re: /emailed\s+reports?/i },
  { phrase: 'email body', re: /email\s+bod(y|ies)/i },
  { phrase: 'email preview', re: /email\s+preview/i },
  { phrase: 'emails (you|daily|weekly)', re: /emails\s+(you|daily|weekly)/i },
  { phrase: 'emailed (daily|weekly)', re: /emailed\s+(daily|weekly)/i },
];

/**
 * Audit one file's text for banned report-email phrasing.
 * Returns an array of { line, phrase } — empty when clean.
 */
export function auditSource(source, _fileName = 'file') {
  const findings = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const { phrase, re } of BANNED_PHRASES) {
      if (re.test(line)) findings.push({ line: i + 1, phrase });
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
      throw new Error(`lint-email-words: root not found: ${resolved} — run from the repo root`);
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
    console.log('lint-email-words: clean — no report-email phrasing found (see the banned list in this file).');
    return 0;
  }
  console.error('lint-email-words: FAIL');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} — banned phrase "${f.phrase}"`);
  }
  console.error('Reports are composed in-app, never emailed — reword to describe the report body instead.');
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(DEFAULT_ROOTS);
}
