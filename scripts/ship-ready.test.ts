import { describe, expect, it } from 'vitest';

import { parseTreeStatus, shipVerdict } from './ship-ready.mjs';

// ── parseTreeStatus: `git status --porcelain` → dirty list ──────────────────
describe('parseTreeStatus', () => {
  it('returns an empty array for a clean tree', () => {
    expect(parseTreeStatus('')).toEqual([]);
    expect(parseTreeStatus('\n  \n')).toEqual([]);
    expect(parseTreeStatus(undefined)).toEqual([]);
  });

  it('lists each porcelain line, trimmed, ignoring blank lines', () => {
    const out = [' M scripts/verify-all.mjs', '?? scripts/ship-ready.mjs', '', ' D docs/launch.md'].join('\n');
    expect(parseTreeStatus(out)).toEqual([
      'M scripts/verify-all.mjs',
      '?? scripts/ship-ready.mjs',
      'D docs/launch.md',
    ]);
  });

  it('handles a single dirty file and trailing newline', () => {
    expect(parseTreeStatus(' M package.json\n')).toEqual(['M package.json']);
  });
});

// ── shipVerdict: dirty-tree / verify-exit → { ready, reason, exitCode } ─────
describe('shipVerdict', () => {
  it('declares SHIP READY only when the tree is clean and verify:all exited 0', () => {
    const v = shipVerdict([], 0);
    expect(v.ready).toBe(true);
    expect(v.reason).toContain('every verify:all gate is green');
    expect(v.exitCode).toBe(0);
  });

  it('blocks with exit 2 on a dirty tree, before even considering verify', () => {
    const v = shipVerdict(['M package.json'], 0);
    expect(v.ready).toBe(false);
    expect(v.reason).toContain('working tree is dirty');
    expect(v.exitCode).toBe(2);
  });

  it('blocks with exit 1 when verify:all fails', () => {
    const v = shipVerdict([], 1);
    expect(v.ready).toBe(false);
    expect(v.reason).toContain('verify:all failed with exit code 1');
    expect(v.exitCode).toBe(1);
  });

  it('blocks with exit 3 when verify:all never ran (spawn failure)', () => {
    const v = shipVerdict([], null);
    expect(v.ready).toBe(false);
    expect(v.reason).toContain('did not run');
    expect(v.exitCode).toBe(3);
  });

  it('dirty tree wins even when verify would have failed', () => {
    const v = shipVerdict(['?? scripts/x.mjs'], 7);
    expect(v.ready).toBe(false);
    expect(v.exitCode).toBe(2);
    expect(v.reason).not.toContain('verify');
  });
});
