import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { crossCheckVerifyAllGates } from './launch-checklist-gates.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

// ── Real repo live-lock ─────────────────────────────────────────────────────
describe('crossCheckVerifyAllGates (live repo)', () => {
  const verifyAllSrc = read('scripts/verify-all.mjs');
  const npmScripts = JSON.parse(read('package.json')).scripts ?? {};

  // Extract the §4 gate commands the same way the drift guard does.
  const doc = read('docs/launch.md');
  const lines = doc.split('\n');
  const startIdx = lines.findIndex((l) => /^## \d+\. The verification gates/.test(l.trim()));
  const nextSection = lines.slice(startIdx + 1).findIndex((l) => /^## /.test(l));
  const sectionLines = nextSection >= 0
    ? lines.slice(startIdx + 1, startIdx + 1 + nextSection)
    : lines.slice(startIdx + 1);
  const gates = sectionLines
    .filter((l) => /^\|\s*`[^`]+`/.test(l))
    .map((row) => row.match(/^\|\s*`([^`]+)`/)[1])
    .filter(Boolean);

  it('passes on the live repo: §4 gates exactly match verify-all.mjs gate names', () => {
    const failures = crossCheckVerifyAllGates({
      docCommands: gates,
      verifyAllSrc,
      npmScripts,
      expectedCount: 12,
    });
    expect(failures).toEqual([]);
  });

  it('catches a gate renamed in verify-all.mjs but not in §4', () => {
    // Simulate renaming dead-words → zombie-words in BOTH the runner's
    // GATE_NAMES and its GATES script field, leaving the doc untouched.
    const renamed = verifyAllSrc
      .replace(/'dead-words'/, "'zombie-words'")
      .replace("script: 'verify:dead-words'", "script: 'verify:zombie-words'");
    const failures = crossCheckVerifyAllGates({
      docCommands: gates,
      verifyAllSrc: renamed,
      npmScripts,
      expectedCount: 12,
    });
    expect(failures.join('\n')).toContain('zombie-words');
    expect(failures.join('\n')).toContain('dead-words');
  });

  it('catches a gate dropped from verify-all.mjs GATE_NAMES', () => {
    // dead-words is the LAST name in the literal and the LAST GATES entry,
    // so both removals are exact single-token edits that leave every other
    // array intact.
    const dropped = verifyAllSrc
      .replace(/'dead-words'\]/, ']')
      .replace(/  \{ name: 'dead-words'[^\n]*\n/, '');
    const failures = crossCheckVerifyAllGates({
      docCommands: gates,
      verifyAllSrc: dropped,
      npmScripts,
      expectedCount: 12,
    });
    expect(failures.join('\n')).toContain('declares 11 gate names');
    expect(failures.join('\n')).toContain('dead-words');
  });
});

// ── Synthetic fixture: deterministic resolution rules ───────────────────────
describe('crossCheckVerifyAllGates (fixture)', () => {
  const FIXTURE = `
const GATE_NAMES = ['alpha', 'beta', 'gamma-direct'];

const GATES = [
  { name: 'alpha', label: 'Alpha', script: 'verify:alpha', secrets: ['A'] },
  { name: 'beta', label: 'Beta', script: 'verify:beta', secrets: ['B'] },
  // gamma is file-based; delta is a script whose file is aliased separately.
  { name: 'gamma-direct', label: 'Gamma (direct)', file: 'scripts/verify-gamma.mjs', duplicateOf: 'alpha' },
];
`;
  const SCRIPTS = {
    'verify:alpha': 'node scripts/verify-alpha.mjs',
    'verify:beta': 'node scripts/verify-beta.mjs',
  };

  it('resolves npm-run gates by their verify: name', () => {
    const failures = crossCheckVerifyAllGates({
      docCommands: ['npm run verify:alpha', 'npm run verify:beta', 'node scripts/verify-gamma.mjs'],
      verifyAllSrc: FIXTURE,
      npmScripts: SCRIPTS,
      expectedCount: 3,
    });
    expect(failures).toEqual([]);
  });

  it('tolerates trailing args on npm gates (deployed-hash style)', () => {
    const failures = crossCheckVerifyAllGates({
      docCommands: ['npm run verify:alpha -- --expect <sha>', 'npm run verify:beta', 'node scripts/verify-gamma.mjs'],
      verifyAllSrc: FIXTURE,
      npmScripts: SCRIPTS,
      expectedCount: 3,
    });
    expect(failures).toEqual([]);
  });

  it('reports a doc command with no matching gate in verify-all.mjs', () => {
    const failures = crossCheckVerifyAllGates({
      docCommands: ['npm run verify:ghost', 'npm run verify:beta', 'node scripts/verify-gamma.mjs'],
      verifyAllSrc: FIXTURE,
      npmScripts: SCRIPTS,
      expectedCount: 3,
    });
    expect(failures.join('\n')).toContain('NOT documented in §4');
    expect(failures.join('\n')).toContain('ghost');
  });

  it('reports a node file that maps to no gate', () => {
    const failures = crossCheckVerifyAllGates({
      docCommands: ['npm run verify:alpha', 'npm run verify:beta', 'node scripts/verify-nope.mjs'],
      verifyAllSrc: FIXTURE,
      npmScripts: SCRIPTS,
      expectedCount: 3,
    });
    expect(failures.join('\n')).toContain('maps to no gate');
    expect(failures.join('\n')).toContain('verify-nope.mjs');
  });

  it('resolves a node file through the npm alias when no file-based gate exists', () => {
    // Rename the gate gamma-direct → gamma in BOTH the names literal and the
    // GATES entry, switching it from a file-based to a script-based gate. The
    // §4 command is still `node scripts/verify-gamma.mjs`, which must now
    // resolve through the npm alias verify:gamma.
    const src = FIXTURE
      .replace("'gamma-direct'", "'gamma'")
      .replace(
        `{ name: 'gamma-direct', label: 'Gamma (direct)', file: 'scripts/verify-gamma.mjs', duplicateOf: 'alpha' }`,
        `{ name: 'gamma', label: 'Gamma', script: 'verify:gamma', duplicateOf: 'alpha' }`,
      );
    const scripts = { ...SCRIPTS, 'verify:gamma': 'node scripts/verify-gamma.mjs' };
    const failures = crossCheckVerifyAllGates({
      docCommands: ['npm run verify:alpha', 'npm run verify:beta', 'node scripts/verify-gamma.mjs'],
      verifyAllSrc: src,
      npmScripts: scripts,
      expectedCount: 3,
    });
    expect(failures).toEqual([]);
  });

  it('fails cleanly when verify-all.mjs has no GATE_NAMES array', () => {
    const src = FIXTURE.replace(/const GATE_NAMES = \[[^\]]*\];\n/, '');
    const failures = crossCheckVerifyAllGates({
      docCommands: [],
      verifyAllSrc: src,
      npmScripts: SCRIPTS,
      expectedCount: 3,
    });
    expect(failures).toEqual([
      'verify-all.mjs has no GATE_NAMES array — a rename or restructure broke the runner.',
    ]);
  });

  it('fails cleanly when verify-all.mjs has no GATES array', () => {
    const src = FIXTURE.replace(/const GATES = \[[\s\S]*?\n\];/, '');
    const failures = crossCheckVerifyAllGates({
      docCommands: [],
      verifyAllSrc: src,
      npmScripts: SCRIPTS,
      expectedCount: 3,
    });
    expect(failures).toEqual([
      'verify-all.mjs has no GATES array — a rename or restructure broke the runner.',
    ]);
  });
});
