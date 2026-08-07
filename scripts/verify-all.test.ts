import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseSubResultMarkers, SUBRESULT_LABELS } from './verify-all-subresults.mjs';

// The gates that EMIT markers: every scripts/verify-*.mjs except the runner
// (verify-all.mjs) and the contract module (verify-all-subresults.mjs), which
// only document/consume the format. Scanning real sources is what makes the
// drift guard genuine: a gate that starts emitting a marker without a label —
// or a label left behind by a gate that stopped emitting it — fails the suite.
const GATE_FILES = readdirSync(join(process.cwd(), 'scripts'))
  .filter((f) => /^verify-.*\.mjs$/.test(f))
  .filter((f) => f !== 'verify-all.mjs' && f !== 'verify-all-subresults.mjs')
  .map((f) => join(process.cwd(), 'scripts', f));

/** Every marker name a gate's source literally emits (`VERIFY-SUBRESULT|<name>|`). */
function emittedMarkerNames() {
  const names = new Set();
  for (const file of GATE_FILES) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/VERIFY-SUBRESULT\|([^|$]+)\|/g)) {
      const name = m[1].trim();
      // Skip the doc-comment placeholder `|<name>|` (not a real emission).
      if (name && !name.startsWith('<')) names.add(name);
    }
  }
  return names;
}

// ── parseSubResultMarkers: the VERIFY-SUBRESULT contract ────────────────────
// verify-all.mjs scans a gate's captured stdout for `VERIFY-SUBRESULT|name|PASS`
// markers and renders each as its own summary row. These tests lock the exact
// syntax so a future gate can't emit a malformed line that silently changes
// the summary (or worse, drifts from the label map).

describe('parseSubResultMarkers · valid markers', () => {
  it('parses PASS and FAIL markers from a synthetic gate stdout', () => {
    const stdout = [
      '  ✓ some gate output line',
      'VERIFY-SUBRESULT|auth-gate|PASS',
      '  ↳ (this is NOT a marker — indented)',
      'VERIFY-SUBRESULT|secret-drift|FAIL',
      '',
    ].join('\n');
    expect(parseSubResultMarkers(stdout, 'cron-reports')).toEqual([
      { name: 'cron-reports/auth-gate', label: '  ↳ Unauthenticated 401 gate (deployed)', pass: true },
      { name: 'cron-reports/secret-drift', label: '  ↳ Deployed CRON_SECRET matches local (deployed)', pass: false },
    ]);
  });

  it('prefixes every marker name with the parent gate name', () => {
    const rows = parseSubResultMarkers('VERIFY-SUBRESULT|sdk-surface|PASS\n', 'google-idp');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('google-idp/sdk-surface');
  });

  it('tolerates trailing whitespace and CRLF line endings after the verdict', () => {
    expect(parseSubResultMarkers('VERIFY-SUBRESULT|check-local|PASS   \r\n', 'deployed-hash')).toEqual([
      { name: 'deployed-hash/check-local', label: '  ↳ Local HEAD matches deployed (deployed)', pass: true },
    ]);
  });
});

describe('parseSubResultMarkers · unknown marker names', () => {
  it('labels an unknown marker with its raw name (fallback, never an invented label)', () => {
    const rows = parseSubResultMarkers('VERIFY-SUBRESULT|brand-new-check|PASS\n', 'future-gate');
    expect(rows).toEqual([
      { name: 'future-gate/brand-new-check', label: '  ↳ brand-new-check (deployed)', pass: true },
    ]);
    // The fallback must not borrow a label from a similar-sounding known marker.
    expect('brand-new-check' in SUBRESULT_LABELS).toBe(false);
    expect(rows[0].label).not.toContain('(admin)');
  });
});

describe('parseSubResultMarkers · malformed lines are rejected', () => {
  it('skips lines that are not VERIFY-SUBRESULT markers', () => {
    const stdout = [
      'VERIFY-SUBRESULT',                    // no segments
      'VERIFY-SUBRESULT|auth-gate',          // missing verdict
      'VERIFY-SUBRESULT|auth-gate|PASS|extra', // extra segment
      'VERIFY-SUBRESULT|auth-gate|maybe',    // non-PASS/FAIL verdict
      'verify-subresult|auth-gate|PASS',     // wrong case prefix
      ' VERIFY-SUBRESULT|auth-gate|PASS',    // leading space
      'prefix VERIFY-SUBRESULT|auth-gate|PASS', // embedded
      'VERIFY-SUBRESULT|a|b|PASS',           // extra pipe in name
      'VERIFY-SUBRESULT||PASS',              // empty name
    ].join('\n');
    expect(parseSubResultMarkers(stdout, 'g')).toEqual([]);
  });

  it('returns an empty array for empty or missing output', () => {
    expect(parseSubResultMarkers('', 'g')).toEqual([]);
    expect(parseSubResultMarkers(undefined, 'g')).toEqual([]);
  });

  it('maps a bare FAIL verdict to pass:false (not confused with a PASS line)', () => {
    const rows = parseSubResultMarkers('VERIFY-SUBRESULT|expect-match|FAIL\n', 'deployed-hash');
    expect(rows[0].pass).toBe(false);
  });
});

// ── Drift guard: gate emissions vs the label map ────────────────────────────
// The real lock: scan every gate's source for the markers it actually emits
// and assert the bidirectional contract — every emitted marker has a friendly
// label, and every label is still emitted by a gate. A hand-written "known
// markers" list would just duplicate the map; scanning sources cannot drift.
describe('SUBRESULT_LABELS vs gate emissions', () => {
  it('finds markers emitted by at least one gate', () => {
    const emitted = emittedMarkerNames();
    expect(emitted.size).toBeGreaterThan(0);
    expect(emitted.has('auth-gate')).toBe(true);
    expect(emitted.has('google-idp-config')).toBe(true);
  });

  it('every marker a gate emits has a friendly label', () => {
    const emitted = emittedMarkerNames();
    for (const name of emitted) {
      expect(SUBRESULT_LABELS[name], `gate emits marker '${name}' but SUBRESULT_LABELS has no label for it`).toBeTruthy();
    }
  });

  it('every label in the map is still emitted by a gate (no stale labels)', () => {
    const emitted = emittedMarkerNames();
    for (const name of Object.keys(SUBRESULT_LABELS)) {
      expect(emitted.has(name), `label for '${name}' exists but no gate emits that marker anymore`).toBe(true);
    }
  });

  it('is non-empty and every label is a string', () => {
    expect(Object.keys(SUBRESULT_LABELS).length).toBeGreaterThan(0);
    for (const [name, label] of Object.entries(SUBRESULT_LABELS)) {
      expect(typeof name).toBe('string');
      expect(typeof label).toBe('string');
    }
  });
});
