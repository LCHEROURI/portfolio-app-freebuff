#!/usr/bin/env node
// ============================================================================
// scripts/verify-read-limits.mjs — static guard for the Firestore read budget.
//
// The read-budget guard in lib/firestore.ts caps the two feed reads the
// store/UI can never display beyond: activity reads newest-first with
// limit(200) (the store's logActivity keeps 200, the Activity page renders
// 100) and reports reads limit(60) (saveReport keeps 60). Those bounds are
// what keep a full pre-push suite + CI verify-deployed day comfortably under
// the Firestore Spark daily read budget (50k reads/day): the owner's activity
// collection alone held ~1.1k docs, so an unbounded read charged ~5x the rows
// the UI can show on every page load, and the verify suite's owner-session
// page loads multiplied that across gates.
//
// This gate asserts the bounded-read contract still holds in lib/firestore.ts:
//   - ACTIVITY_READ_LIMIT exists and equals 200, REPORTS_READ_LIMIT equals 60
//     (the exact store-mirroring caps; a coordinated raise must update BOTH
//     this gate and lib/firestore.ts deliberately);
//   - the activity query actually applies orderBy('__name__','desc') +
//     limit(ACTIVITY_READ_LIMIT) — a future edit that drops the newest-first
//     ordering or the limit fails here;
//   - the reports query actually applies limit(REPORTS_READ_LIMIT);
//   - no UNBOUNDED read path remains for either collection: the generic
//     listAll() helper is not used to read activity or reports.
// A future edit that unbounds either feed fails CI instead of silently
// returning to the 50k/day cap.
//
// Deliberately line-based (a regex per line), like the dead-words lint: the
// contract is about which query construction appears in the source, and the
// exact calls are short enough that substring matching is the right tool.
//
// Usage:
//   node scripts/verify-read-limits.mjs
//   npm run verify:read-limits        # standalone
//   npm run lint                      # after import-surface + dead-words
//   npm run verify:all                # the 18th §4 gate
//
// Exports (for the unit test): auditSource, main. Read-only against the
// working tree.
// ============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = process.cwd();
const TARGET = 'lib/firestore.ts';

// The exact store-mirroring caps (lib/firestore.ts declares the same numbers
// as its own ACTIVITY_READ_LIMIT / REPORTS_READ_LIMIT constants — the gate
// parses the declarations out of the source rather than hardcoding a copy
// that could drift, then asserts the query construction actually applies
// them).
const ACTIVITY_LIMIT = 200;
const REPORTS_LIMIT = 60;

const LIMIT_DECL_RE = /const\s+(ACTIVITY_READ_LIMIT|REPORTS_READ_LIMIT)\s*=\s*(\d+);/g;
// The activity feed must stay newest-first: doc ids are `a-<base36-ms><rand>`
// (timestamp-prefixed), so document-id DESC returns newest-first on the
// DEFAULT index — no composite index needed. A future edit that drops the
// ordering reverts to ascending (oldest-first) display, which is both wrong
// and a regression of the read-budget fix.
const ACTIVITY_QUERY_RE = /query\(\s*col\(db,\s*'activity'\)[\s\S]*?orderBy\('__name__',\s*'desc'\)[\s\S]*?limit\(ACTIVITY_READ_LIMIT\)/;
const REPORTS_QUERY_RE = /query\(\s*col\(db,\s*'reports'\)[\s\S]*?limit\(REPORTS_READ_LIMIT\)/;
// The generic unbounded read helper must never be pointed at the two bounded
// feeds — that is exactly how the 1.1k-doc unbounded activity read came back.
const UNBOUNDED_LIST_RE = /listAll\s*(?:<[^>]*>)?\s*\(\s*db\s*,\s*'(activity|reports)'/;

/**
 * Audit lib/firestore.ts's source for the bounded-read contract.
 * Returns an array of { line, finding } — empty when clean.
 */
export function auditSource(source) {
  const findings = [];
  const lines = source.split('\n');
  const push = (line, finding) => findings.push({ line, finding });

  // 1. The limit constants must be declared with the exact store-mirroring
  // values (200 / 60). Missing, renumbered, or re-typed declarations fail.
  const declared = new Map();
  for (const m of source.matchAll(LIMIT_DECL_RE)) declared.set(m[1], Number(m[2]));
  for (const [name, expected] of [['ACTIVITY_READ_LIMIT', ACTIVITY_LIMIT], ['REPORTS_READ_LIMIT', REPORTS_LIMIT]]) {
    if (!declared.has(name)) {
      push(0, `lib/firestore.ts declares no ${name} constant — the read-budget guard is gone.`);
    } else if (declared.get(name) !== expected) {
      push(0, `lib/firestore.ts ${name} = ${declared.get(name)}, expected ${expected} — a coordinated raise must update this gate AND the store caps together.`);
    }
  }

  // 2. The activity query must apply newest-first ordering + the limit.
  if (!ACTIVITY_QUERY_RE.test(source)) {
    const line = lines.findIndex((l) => /listActivity|col\(db, 'activity'\)/.test(l)) + 1;
    push(line || 0, 'lib/firestore.ts activity query must apply orderBy(\'__name__\', \'desc\') + limit(ACTIVITY_READ_LIMIT) — an unbounded or oldest-first activity read regresses the read budget.');
  }

  // 3. The reports query must apply the limit.
  if (!REPORTS_QUERY_RE.test(source)) {
    const line = lines.findIndex((l) => /listReports|col\(db, 'reports'\)/.test(l)) + 1;
    push(line || 0, 'lib/firestore.ts reports query must apply limit(REPORTS_READ_LIMIT) — an unbounded reports read regresses the read budget.');
  }

  // 4. No unbounded listAll() read of either feed.
  const ub = source.match(UNBOUNDED_LIST_RE);
  if (ub) {
    const line = lines.findIndex((l) => l.includes(ub[1])) + 1;
    push(line || 0, `lib/firestore.ts reads '${ub[1]}' through the unbounded listAll() helper — use the bounded listActivity/listReports path.`);
  }

  return findings;
}

export function main() {
  const file = resolve(REPO_ROOT, TARGET);
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`verify-read-limits: cannot read ${TARGET}: ${err.message}`);
    return 1;
  }
  const findings = auditSource(source);
  if (findings.length === 0) {
    console.log(`verify-read-limits: clean — ${TARGET} still carries the bounded feed reads (activity newest-first limit(${ACTIVITY_LIMIT}), reports limit(${REPORTS_LIMIT})).`);
    return 0;
  }
  console.error(`verify-read-limits: FAIL — ${TARGET} regressed the Firestore read budget:`);
  for (const f of findings) {
    console.error(`  ${TARGET}:${f.line || '?'} — ${f.finding}`);
  }
  console.error('Restore the bounded reads (or update this gate deliberately with the coordinated change).');
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
