import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { crossCheckVerifyAllGates, crossCheckVerifyAllSecrets, parseLaunchChecklistTable } from './launch-checklist-gates.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

// ── parseLaunchChecklistTable: the §4 table parser ──────────────────────────
describe('parseLaunchChecklistTable (live repo)', () => {
  const doc = read('docs/launch.md');
  const { header, rows } = parseLaunchChecklistTable(doc);

  it('finds the §4 header with a Requires column', () => {
    expect(header).toMatch(/^\|\s*Gate\s*\|\s*Requires\s*\|/);
  });

  it('parses all 14 gate rows with their Requires cells', () => {
    expect(rows).toHaveLength(14);
    for (const row of rows) {
      expect(row.command).toMatch(/^(npm run verify:|node scripts\/)/);
      // Every row must carry a secrets requirement cell — the contract under
      // test. A blank cell means the column was dropped for that row.
      expect(row.requires.trim(), `"${row.command}" has an empty Requires cell`).not.toBe('');
    }
  });

  it('captures known Requires cells exactly', () => {
    const byCommand = new Map(rows.map((r) => [r.command, r.requires]));
    expect(byCommand.get('npm run verify:cron-reports')).toBe('`CRON_SECRET`');
    expect(byCommand.get('npm run verify:token-health')).toBe('`VERCEL_TOKEN`');
    expect(byCommand.get('npm run verify:import-surface')).toBe('—');
    expect(byCommand.get('npm run verify:dead-words')).toBe('—');
  });
});

// ── crossCheckVerifyAllSecrets: live repo (the real lock) ───────────────────
describe('crossCheckVerifyAllSecrets (live repo)', () => {
  const doc = read('docs/launch.md');
  const verifyAllSrc = read('scripts/verify-all.mjs');
  const npmScripts = JSON.parse(read('package.json')).scripts ?? {};
  const { header, rows } = parseLaunchChecklistTable(doc);

  it('passes: every §4 Requires cell exactly matches verify-all.mjs secrets', () => {
    const failures = crossCheckVerifyAllSecrets({ rows, header, verifyAllSrc, npmScripts });
    expect(failures).toEqual([]);
  });

  it('catches a secret added to verify-all.mjs but not documented in §4', () => {
    // Simulate the runner gaining a new required secret (firestore-rules →
    // + REPORT_OWNER_ID) while the doc row is untouched.
    const drifted = verifyAllSrc.replace(
      "secrets: ['NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'FIREBASE_WEB_API_KEY'], capture: true",
      "secrets: ['NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'FIREBASE_WEB_API_KEY', 'REPORT_OWNER_ID'], capture: true",
    );
    const failures = crossCheckVerifyAllSecrets({ rows, header, verifyAllSrc: drifted, npmScripts });
    expect(failures.join('\n')).toContain('REPORT_OWNER_ID');
    expect(failures.join('\n')).toContain('firestore-rules');
  });

  it('catches a Requires cell emptied in the doc while the runner still declares secrets', () => {
    const broken = rows.map((r) =>
      r.command === 'npm run verify:cron-reports' ? { ...r, requires: '' } : r,
    );
    const failures = crossCheckVerifyAllSecrets({ rows: broken, header, verifyAllSrc, npmScripts });
    expect(failures.join('\n')).toContain('EMPTY Requires cell');
    expect(failures.join('\n')).toContain('cron-reports');
  });

  it('fails when the §4 header loses the Requires column', () => {
    const failures = crossCheckVerifyAllSecrets({
      rows,
      header: '| Gate | What it proves |',
      verifyAllSrc,
      npmScripts,
    });
    expect(failures.join('\n')).toContain('Requires');
  });
});

// ── crossCheckVerifyAllSecrets: synthetic fixture (deterministic) ───────────
describe('crossCheckVerifyAllSecrets (fixture)', () => {
  const FIXTURE = `
const GATE_NAMES = ['alpha', 'beta', 'gamma-direct'];

const GATES = [
  { name: 'alpha', label: 'Alpha', script: 'verify:alpha', secrets: ['A_SECRET'] },
  { name: 'beta', label: 'Beta', script: 'verify:beta', secrets: [] },
  // gamma-direct mirrors auth-domains-direct: a file-based gate that still
  // declares its own secrets (the doc row lists A_SECRET for it).
  { name: 'gamma-direct', label: 'Gamma (direct)', file: 'scripts/verify-gamma.mjs', duplicateOf: 'alpha', secrets: ['A_SECRET'] },
];
`;
  const SCRIPTS = {
    'verify:alpha': 'node scripts/verify-alpha.mjs',
    'verify:beta': 'node scripts/verify-beta.mjs',
  };
  const DOC = `
## 4. The verification gates — run all of them before go-live

| Gate | Requires | What it proves |
| --- | --- | --- |
| \`npm run verify:alpha\` | \`A_SECRET\` | Proves alpha |
| \`npm run verify:beta\` | — | Proves beta |
| \`node scripts/verify-gamma.mjs\` | \`A_SECRET\` | Proves gamma |
`;
  const { header, rows } = parseLaunchChecklistTable(DOC);

  it('passes on a consistent fixture', () => {
    const failures = crossCheckVerifyAllSecrets({ rows, header, verifyAllSrc: FIXTURE, npmScripts: SCRIPTS });
    expect(failures).toEqual([]);
  });

  it('flags an extra secret listed in the doc but not declared by the runner', () => {
    const broken = rows.map((r) =>
      r.command === 'npm run verify:alpha' ? { ...r, requires: '`A_SECRET`, `GHOST`' } : r,
    );
    const failures = crossCheckVerifyAllSecrets({ rows: broken, header, verifyAllSrc: FIXTURE, npmScripts: SCRIPTS });
    expect(failures.join('\n')).toContain('GHOST');
    expect(failures.join('\n')).toContain('alpha');
  });

  it('flags a doc row that omits a required secret (— instead of the secret)', () => {
    const broken = rows.map((r) =>
      r.command === 'npm run verify:alpha' ? { ...r, requires: '—' } : r,
    );
    const failures = crossCheckVerifyAllSecrets({ rows: broken, header, verifyAllSrc: FIXTURE, npmScripts: SCRIPTS });
    expect(failures.join('\n')).toContain('A_SECRET');
  });

  it('fails cleanly when verify-all.mjs has no GATES array', () => {
    const src = FIXTURE.replace(/const GATES = \[[\s\S]*?\n\];/, '');
    const failures = crossCheckVerifyAllSecrets({ rows, header, verifyAllSrc: src, npmScripts: SCRIPTS });
    expect(failures).toEqual([
      'verify-all.mjs has no GATES array — a rename or restructure broke the runner.',
    ]);
  });

  it('keeps row alignment when a MID-TABLE row fails to resolve (no gate shift)', () => {
    // Plant an unresolvable command in the middle. The row AFTER it must still
    // be checked against ITS OWN gate — a compressed docNames list would shift
    // beta onto gamma-direct's secrets and falsely report a mismatch.
    const broken = [...rows];
    broken.splice(1, 0, { command: 'node scripts/verify-ghost.mjs', requires: '`A_SECRET`' });
    const failures = crossCheckVerifyAllSecrets({ rows: broken, header, verifyAllSrc: FIXTURE, npmScripts: SCRIPTS });
    const joined = failures.join('\n');
    // The ghost row is reported unresolved; the rows around it stay aligned:
    // beta (no secrets, — ) must NOT be flagged against gamma-direct's secrets.
    expect(joined).toContain('maps to no gate');
    expect(joined).toContain('verify-ghost.mjs');
    expect(joined).not.toContain('(gate beta)');
    expect(joined).not.toContain('(gate gamma-direct)');
  });
});

// ── Shared parsing sanity: the name and secrets checks use the same GATES ───
describe('crossCheckVerifyAllGates still passes with the shared parser (live repo)', () => {
  const doc = read('docs/launch.md');
  const verifyAllSrc = read('scripts/verify-all.mjs');
  const npmScripts = JSON.parse(read('package.json')).scripts ?? {};
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

  it('the name cross-check still passes after the refactor', () => {
    const failures = crossCheckVerifyAllGates({
      docCommands: gates,
      verifyAllSrc,
      npmScripts,
      expectedCount: 14,
    });
    expect(failures).toEqual([]);
  });
});
