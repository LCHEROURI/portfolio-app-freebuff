import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/readme-handoff.test.ts — lock the README handoff gate table to the
// runner's gate names.
//
// The README's `## Handoff — read this first` section carries an
// "The 13 verification gates" table — the overview surface a cold maintainer
// meets first. scripts/verify-all.mjs's GATE_NAMES array is the source of
// truth the one-command runner actually EXECUTES. If a gate is renamed in the
// runner without a README update (or a row is dropped / a gate is invented in
// the README), the onboarding doc drifts from reality silently. This test
// reads both REAL files from disk and asserts the README table's gate column
// equals GATE_NAMES exactly (same names, same order, no dupes) — the same
// set-equality contract launch-checklist-gates.mjs applies to docs/launch.md
// §4, applied to the README's overview table.
//
// verify-all.mjs cannot be imported here: it runs the full gate suite at
// module level, so the authoritative names are parsed from its GATE_NAMES
// source line instead (the same text-parse approach the drift guard uses).
// ============================================================================

const README = readFileSync('README.md', 'utf8');
const VERIFY_ALL = readFileSync('scripts/verify-all.mjs', 'utf8');

/**
 * The gate names listed in the README handoff's "The 13 verification gates"
 * table, in order. Parsed strictly inside that section (from the heading to
 * the next `### ` heading) so another table elsewhere in the README can't
 * satisfy the assertions. Returns [] when the section is missing.
 */
export function parseReadmeGateNames(readmeText: string): string[] {
  const sectionStart = readmeText.indexOf('### The 13 verification gates');
  if (sectionStart === -1) return [];
  const nextHeading = readmeText.indexOf('\n### ', sectionStart + 1);
  const section =
    nextHeading === -1
      ? readmeText.slice(sectionStart)
      : readmeText.slice(sectionStart, nextHeading);
  return section
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.startsWith('| ---'))
    .map((line) => line.match(/^\|\s*([a-z0-9-]+)\s*\|/)?.[1])
    .filter((n): n is string => n !== undefined && n !== 'Gate');
}

/** The runner's authoritative gate names, in order, from GATE_NAMES. */
const runnerGateNames = (() => {
  const line = VERIFY_ALL.match(/const GATE_NAMES = \[([^\]]*)\]/)?.[1] ?? '';
  return [...line.matchAll(/'([^']+)'/g)].map((m) => m[1]);
})();

describe('parseReadmeGateNames (pure helper)', () => {
  it('returns the gate column of the handoff table in order', () => {
    const readme = [
      '## Handoff — read this first',
      '### The 13 verification gates',
      '| Gate | Requires | Proves |',
      '| --- | --- | --- |',
      '| token-health | `VERCEL_TOKEN` | alive token |',
      '| dead-words | — | no dead phrasing |',
      '### The three-secret-store reality',
      '| Gate | Requires | Proves |',
      '| rogue-table | — | not part of the handoff |',
    ].join('\n');
    expect(parseReadmeGateNames(readme)).toEqual(['token-health', 'dead-words']);
  });

  it('ignores tables outside the handoff section', () => {
    const readme = [
      '# README',
      '| Gate | Requires | Proves |',
      '| not-a-handoff-row | — | earlier table |',
      '### The 13 verification gates',
      '| Gate | Requires | Proves |',
      '| --- | --- | --- |',
      '| import-surface | — | lint |',
    ].join('\n');
    expect(parseReadmeGateNames(readme)).toEqual(['import-surface']);
  });

  it('returns [] when the handoff section is missing', () => {
    expect(parseReadmeGateNames('# no handoff here')).toEqual([]);
  });
});

describe('README handoff gate table contract', () => {
  it('has the expected table shape in the handoff section', () => {
    const sectionStart = README.indexOf('### The 13 verification gates');
    expect(sectionStart).toBeGreaterThan(-1);
    const section = README.slice(sectionStart);
    expect(section).toContain('| Gate | Requires | Proves |');
  });

  it('lists exactly the runner gate names, in order, with no drift', () => {
    expect(runnerGateNames).toHaveLength(13);
    expect(parseReadmeGateNames(README)).toEqual(runnerGateNames);
  });

  it('parses the runner GATE_NAMES source line (ground truth, not a stub)', () => {
    expect(runnerGateNames).toContain('dead-words');
    expect(runnerGateNames).toContain('import-surface');
    expect(runnerGateNames).toContain('deployed-hash');
  });
});
