import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseSubResultMarkers, SUBRESULT_LABELS } from './verify-all-subresults.mjs';

// The gates that EMIT markers: every scripts/verify-*.mjs plus the
// maintain-conv-db.mjs gate (which runs as verify:all's conv-db row and emits
// wal-* markers), except the runner (verify-all.mjs) and the contract module
// (verify-all-subresults.mjs), which only document/consume the format.
// Scanning real sources is what makes the drift guard genuine: a gate that
// starts emitting a marker without a label — or a label left behind by a gate
// that stopped emitting it — fails the suite.
const GATE_FILES = readdirSync(join(process.cwd(), 'scripts'))
  .filter((f) => /^verify-.*\.mjs$/.test(f) || f === 'maintain-conv-db.mjs')
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

// ── conv-db gate's '(local)' suffix contract ────────────────────────────────
// The conv-db gate runs the LOCAL WAL maintainer (scripts/maintain-conv-db.mjs),
// so its wal-* sub-rows must never be mislabeled '(deployed)' — that would
// claim a local-machine probe ran against the live app. These tests lock the
// whole chain: the GATES entry declares subSuffix: '(local)', the runner
// forwards gate.subSuffix into the parser (so dropping the field silently
// reverts to the '(deployed)' default), and the parser renders wal-* markers
// with the local suffix.

describe('verify-all.mjs · conv-db gate (local) suffix contract', () => {
  const src = readFileSync(join(process.cwd(), 'scripts', 'verify-all.mjs'), 'utf8');

  it('declares the conv-db gate with subSuffix (local), not the deployed default', () => {
    expect(src).toMatch(/name: 'conv-db',[^}]*subSuffix: '\(local\)'/);
  });

  it('is the only gate carrying a non-default subSuffix today', () => {
    // A second local-only gate is legitimate but must add its own suffix
    // deliberately; a future edit that drops conv-db's field makes this list
    // empty and fails the lock instead of silently relabeling the rows.
    const gatesBody = src.match(/const GATES = \[([\s\S]*?)\n\];/)?.[1] ?? '';
    expect([...gatesBody.matchAll(/subSuffix: '([^']+)'/g)].map((m) => m[1])).toEqual(['(local)']);
  });

  it('forwards gate.subSuffix into parseSubResultMarkers (suffix reaches the parser)', () => {
    expect(src).toMatch(/parseSubResultMarkers\(captured, gate\.name, undefined, gate\.subSuffix\)/);
  });

  it('renders wal-* markers with the local suffix instead of (deployed)', () => {
    expect(parseSubResultMarkers('VERIFY-SUBRESULT|wal-idle|PASS\n', 'conv-db', undefined, '(local)')).toEqual([
      { name: 'conv-db/wal-idle', label: '  ↳ Conv DB WAL at/below threshold (idle) (local)', pass: true },
    ]);
  });
});

// ── Capture/marker contract: every deployed gate captures AND emits ─────────
// A gate's summary sub-rows exist only if BOTH halves hold: (a) the GATES
// entry declares capture: true, so the runner parses the gate's piped stdout
// for VERIFY-SUBRESULT lines, and (b) the gate's script actually emits at
// least one marker. Either half silently disappearing loses sub-rows from the
// summary with no failure anywhere — these tests lock both directions so a
// silent capture loss is caught. Gate → script resolution mirrors the runner:
// direct `file` when present, else the npm script's `node scripts/X.mjs`
// target from package.json (which also covers the two lints, whose scripts
// are not named verify-*.mjs).

describe('verify-all.mjs · capture/marker contract', () => {
  const src = readFileSync(join(process.cwd(), 'scripts', 'verify-all.mjs'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

  // Parse every GATES entry into { name, capture, file, script, subSuffix }.
  // Entries are one line each (`  { name: '…', … },`), so splitting on lines
  // and matching the opening brace is exact — and the explicit 14-entry
  // assertion below keeps this parse from ever going silently empty.
  const gatesBody = src.match(/const GATES = \[([\s\S]*?)\n\];/)?.[1] ?? '';
  const gates = gatesBody
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{ name: '))
    .map((line) => ({
      name: line.match(/name: '([^']+)'/)?.[1] ?? '',
      capture: /capture: true/.test(line),
      file: line.match(/file: '([^']+)'/)?.[1] ?? null,
      script: line.match(/script: '([^']+)'/)?.[1] ?? null,
      subSuffix: line.match(/subSuffix: '([^']+)'/)?.[1] ?? null,
    }));

  // Resolve a gate to its script file, exactly like the runner spawns it.
  const gateFile = (gate) => {
    if (gate.file) return join(process.cwd(), gate.file);
    const cmd = pkg.scripts[gate.script] ?? '';
    const m = cmd.match(/node scripts\/([^\s]+\.mjs)/);
    return m ? join(process.cwd(), 'scripts', m[1]) : null;
  };

  // Marker names a script's source literally emits (same scan as the
  // SUBRESULT_LABELS drift guard above, minus the doc placeholder).
  const emittedBy = (file) => {
    if (!file || !existsSync(file)) return new Set();
    const names = new Set();
    for (const m of readFileSync(file, 'utf8').matchAll(/VERIFY-SUBRESULT\|([^|$]+)\|/g)) {
      const name = m[1].trim();
      if (name && !name.startsWith('<')) names.add(name);
    }
    return names;
  };

  it('parses all 15 GATES entries (the contract never goes vacuous)', () => {
    expect(gates).toHaveLength(15);
    expect(gates.filter((g) => g.capture).length).toBeGreaterThan(0);
  });

  it('every capture gate resolves to a script that emits at least one marker', () => {
    for (const gate of gates.filter((g) => g.capture)) {
      const file = gateFile(gate);
      expect(file, `capture gate '${gate.name}' does not resolve to a script file`).toBeTruthy();
      const names = emittedBy(file);
      expect(names.size, `capture gate '${gate.name}' (${file}) emits no VERIFY-SUBRESULT markers`).toBeGreaterThan(0);
    }
  });

  it('every gate whose script emits markers declares capture: true (no silent capture loss)', () => {
    for (const gate of gates) {
      const file = gateFile(gate);
      if (!file) continue;
      const names = emittedBy(file);
      if (names.size > 0) {
        expect(gate.capture, `gate '${gate.name}' emits markers (${[...names].join(', ')}) but lacks capture: true`).toBe(true);
      }
    }
  });

  it('every capture gate renders its sub-rows with a suffix — (local) for conv-db, the deployed default elsewhere', () => {
    for (const gate of gates.filter((g) => g.capture)) {
      if (gate.name === 'conv-db') {
        expect(gate.subSuffix).toBe('(local)');
      } else {
        expect(gate.subSuffix ?? '(deployed)', `capture gate '${gate.name}' must not carry a non-default subSuffix`).toBe('(deployed)');
      }
    }
  });
});

// ── Static companion row: onboarding-doc pipeline-diagram presence ──────────
// verify-all.mjs reports the pipeline diagram's presence as its own summary
// row (an inline run of crossCheckPipelineDiagrams, the same pure check the
// drift guard's [3e/4] step runs). These tests lock that row's contract: the
// import exists, the invocation reads BOTH onboarding docs, failures reach the
// shared failures array, and — critically — the row stays OUT of
// GATE_NAMES/GATES so the 11-gate §4 contract the drift guard enforces is
// never silently widened.

describe('verify-all.mjs · onboarding-doc pipeline-diagram presence row', () => {
  const src = readFileSync(join(process.cwd(), 'scripts', 'verify-all.mjs'), 'utf8');

  it('imports crossCheckPipelineDiagrams from the shared gates module', () => {
    expect(src).toMatch(/import \{[^}]*crossCheckPipelineDiagrams[^}]*\} from '\.\/launch-checklist-gates\.mjs';/);
  });

  it('runs the presence check inline against BOTH onboarding docs', () => {
    expect(src).toContain('readmeSrc: readFileSync(resolve(process.cwd(), \'README.md\'), \'utf8\')');
    expect(src).toContain('launchSrc: readFileSync(resolve(process.cwd(), \'docs/launch.md\'), \'utf8\')');
  });

  it('pushes the picture as its own summary row with a friendly label', () => {
    expect(src).toContain("label: 'Onboarding-doc pipeline diagram presence'");
    expect(src).toContain('results.push({');
    expect(src).toContain('static: true');
  });

  it('routes failures through the shared failures array so a missing picture fails the run', () => {
    expect(src).toContain("failures.push('pipeline-diagram')");
    expect(src).toContain('for (const msg of pictureFailures) console.error');
  });

  it('stays OUT of GATE_NAMES so the 11-gate §4 contract is intact', () => {
    // The row is a companion check, not a 12th gate. If it ever joins
    // GATE_NAMES, the launch-checklist drift guard cross-check would fail
    // (the runner's gate names must exactly match §4's fourteen), so this
    // assertion pins the deliberate exclusion.
    const gateNamesLine = src.match(/const GATE_NAMES = \[[^\]]*\]/)?.[0] ?? '';
    expect(gateNamesLine).not.toContain('pipeline-diagram');
    // And the static row must not be a runnable GATES entry either.
    expect(src.match(/name: 'pipeline-diagram'/g) ?? []).toHaveLength(1);
  });

  it('excludes the static row from the no-gates-ran guard', () => {
    // The companion row always runs; if it counted toward ranCount, --skip of
    // every gate would report PASS off the picture row alone instead of
    // exiting 2 with "no gates ran".
    expect(src).toContain("r.pass !== 'covered' && !r.gate.static");
  });
});

// ── verify-all.mjs's 15-gate self-check ────────────────────────────────────
// The runner asserts GATE_NAMES.length === 15 (matching the drift guard's
// EXPECTED_GATE_COUNT) BEFORE the preflight spawn or any gate executes, so a
// future gate added without the full contract update fails loudly at runtime
// instead of silently widening the table.

describe('verify-all.mjs · 15-gate runtime self-check', () => {
  const src = readFileSync(join(process.cwd(), 'scripts', 'verify-all.mjs'), 'utf8');

  it('hardcodes EXPECTED_GATE_COUNT = 15 matching the drift guard', () => {
    // The runner and verify-launch-checklist.mjs must promise the SAME count;
    // a future gate bump that touches only one file fails this lock.
    expect(src).toContain('const EXPECTED_GATE_COUNT = 15;');
    const drift = readFileSync(join(process.cwd(), 'scripts', 'verify-launch-checklist.mjs'), 'utf8');
    expect(drift).toContain('const EXPECTED_GATE_COUNT = 15;');
  });

  it('asserts GATE_NAMES.length === EXPECTED_GATE_COUNT before the preflight and any gate runs', () => {
    // Positional contract: the self-check must sit BEFORE the preflight spawn
    // (which only runs after the arrays are defined) and the gate loop, so a
    // widened table aborts before a single gate executes.
    const checkIdx = src.indexOf('GATE_NAMES.length !== EXPECTED_GATE_COUNT');
    expect(checkIdx).toBeGreaterThan(-1);
    const preflightIdx = src.indexOf('Launch checklist runner');
    const gateLoopIdx = src.indexOf('for (const gate of GATES)');
    expect(preflightIdx).toBeGreaterThan(checkIdx);
    expect(gateLoopIdx).toBeGreaterThan(checkIdx);
  });

  it('exits nonzero with a loud contract message on mismatch', () => {
    // Scope the exit assertion to the self-check block itself (between the
    // constant and the results array) — a file-wide regex would be satisfied
    // by the unknown-gate block's process.exit(2) even if the self-check's own
    // exit were silently removed.
    const block = src.slice(src.indexOf('const EXPECTED_GATE_COUNT = 15;'), src.indexOf('const failures = [];'));
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain('launch-checklist contract promises');
    expect(block).toContain('Update every surface together, then re-run.');
    expect(block).toMatch(/process\.exit\(2\);/);
  });

  it('keeps GATE_NAMES and GATES at 15 entries today (live-tree lock)', () => {
    // The self-check must pass on the real tree right now: both arrays hold
    // exactly 15 entries and agree with each other, so the guard is green
    // rather than dead code that trips on the next run.
    const gateNames = src.match(/const GATE_NAMES = \[([^\]]*)\]/)?.[1] ?? '';
    expect([...gateNames.matchAll(/'([^']+)'/g)]).toHaveLength(15);
    const gatesBody = src.match(/const GATES = \[([\s\S]*?)\n\];/)?.[1] ?? '';
    expect([...gatesBody.matchAll(/name: '([^']+)'/g)]).toHaveLength(15);
  });
});

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
