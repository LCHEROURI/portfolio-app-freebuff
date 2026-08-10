import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { auditSource } from './verify-read-limits.mjs';

// ============================================================================
// scripts/verify-read-limits.test.ts — lock the Firestore read-budget guard.
//
// The bounded-read contract (lib/firestore.ts activity newest-first
// limit(200), reports limit(60)) is what keeps a full pre-push suite + CI
// verify-deployed day under the Firestore Spark 50k-read daily budget. This
// test locks BOTH directions of the verify-read-limits gate:
//   - the gate fails on every way a future edit could unbound a feed (missing
//     constant, dropped orderBy, dropped limit, listAll() pointed at the
//     feeds) — proven with synthetic mutations of a valid fixture;
//   - the gate passes on the LIVE tree right now, so it is green rather than
//     dead code (and the exact 200/60 values are pinned to today's store
//     caps, so a coordinated raise is a deliberate, loud change).
// ============================================================================

// A valid fixture mirroring the read-budget guard's shape in lib/firestore.ts.
const VALID = `
const ACTIVITY_READ_LIMIT = 200;
const REPORTS_READ_LIMIT = 60;

const listActivity = async (db, userId) => {
  const snap = await getDocs(query(
    col(db, 'activity'),
    where('userId', '==', userId),
    orderBy('__name__', 'desc'),
    limit(ACTIVITY_READ_LIMIT),
  ));
  return snap.docs;
};

const listReports = async (db, userId) => {
  const snap = await getDocs(query(
    col(db, 'reports'),
    where('userId', '==', userId),
    limit(REPORTS_READ_LIMIT),
  ));
  return snap.docs;
};
`;

describe('verify-read-limits · auditSource (synthetic)', () => {
  it('passes a source that still carries the bounded reads', () => {
    expect(auditSource(VALID)).toEqual([]);
  });

  it('fails when the ACTIVITY_READ_LIMIT constant is missing', () => {
    const src = VALID.replace('const ACTIVITY_READ_LIMIT = 200;\n', '');
    const findings = auditSource(src);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.finding.includes('ACTIVITY_READ_LIMIT'))).toBe(true);
  });

  it('fails when the REPORTS_READ_LIMIT constant is missing', () => {
    const src = VALID.replace('const REPORTS_READ_LIMIT = 60;\n', '');
    const findings = auditSource(src);
    expect(findings.some((f) => f.finding.includes('REPORTS_READ_LIMIT'))).toBe(true);
  });

  it('fails when a limit constant drifts from the store-mirroring value', () => {
    const src = VALID.replace('const ACTIVITY_READ_LIMIT = 200;', 'const ACTIVITY_READ_LIMIT = 5000;');
    const findings = auditSource(src);
    expect(findings.some((f) => f.finding.includes('expected 200'))).toBe(true);
  });

  it('fails when the activity query loses the newest-first ordering', () => {
    const src = VALID.replace("    orderBy('__name__', 'desc'),\n", '');
    const findings = auditSource(src);
    expect(findings.some((f) => f.finding.includes('orderBy'))).toBe(true);
  });

  it('fails when the activity query loses the limit call', () => {
    const src = VALID.replace('    limit(ACTIVITY_READ_LIMIT),\n', '');
    const findings = auditSource(src);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('fails when the reports query loses the limit call', () => {
    const src = VALID.replace('    limit(REPORTS_READ_LIMIT),\n', '');
    const findings = auditSource(src);
    expect(findings.some((f) => f.finding.includes('reports query'))).toBe(true);
  });

  it('fails when activity is read through the unbounded listAll() helper', () => {
    const src = `${VALID}\nconst all = await listAll<ActivityEntry>(db, 'activity', userId);\n`;
    const findings = auditSource(src);
    expect(findings.some((f) => f.finding.includes("'activity'") && f.finding.includes('listAll'))).toBe(true);
  });

  it('fails when reports is read through the unbounded listAll() helper', () => {
    const src = `${VALID}\nconst all = await listAll(db, 'reports', userId);\n`;
    const findings = auditSource(src);
    expect(findings.some((f) => f.finding.includes("'reports'") && f.finding.includes('listAll'))).toBe(true);
  });
});

describe('verify-read-limits · live tree', () => {
  const src = readFileSync('lib/firestore.ts', 'utf8');

  it('passes on the real lib/firestore.ts right now (green, not dead code)', () => {
    expect(auditSource(src)).toEqual([]);
  });

  it('pins the exact store-mirroring caps at 200/60 today', () => {
    expect(src).toContain('const ACTIVITY_READ_LIMIT = 200;');
    expect(src).toContain('const REPORTS_READ_LIMIT = 60;');
  });

  it('the bounded queries reference the constants (not a raw literal that could drift)', () => {
    expect(src).toMatch(/limit\(ACTIVITY_READ_LIMIT\)/);
    expect(src).toMatch(/limit\(REPORTS_READ_LIMIT\)/);
  });
});
