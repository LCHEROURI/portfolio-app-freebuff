import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DISK_LIMIT_PCT,
  DEFAULT_DISK_WARN_PCT,
  diskHeadroomVerdict,
  parseUsePct,
  probeUsePct,
  resolveLimit,
  resolveWarn,
} from './verify-disk-headroom.mjs';

// probeUsePct takes the df runner as an injectable argument (default: real
// execFileSync), so the mount-probing contract — Data volume first, root
// fallback, skip-not-fail on total failure — is lockable with fake runners
// and no built-in mocking.
const DF_OUT = (capacity, mount) =>
  `Filesystem   1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on\n/dev/disk3s5   239362496 174665368  42192648    ${capacity}% 2863304 421926480    1%   ${mount}\n`;

// ============================================================================
// scripts/verify-disk-headroom.test.ts — lock the disk-headroom gate's pure
// helpers. parseUsePct and resolveLimit carry the whole decision: the df
// parsing must never produce a bogus value (a mis-parse could silently
// disable the gate), and the limit must never be silently disabled by a
// malformed env override.
// ============================================================================

describe('parseUsePct · real df -k output', () => {
  it('parses the Capacity column from a real macOS df -k row', () => {
    // Real output shape from `df -k /System/Volumes/Data` on this machine.
    const out = [
      'Filesystem   1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on',
      '/dev/disk3s5   239362496 174665368  42192648    81% 2863304 421926480    1%   /System/Volumes/Data',
    ].join('\n');
    expect(parseUsePct(out)).toBe(81);
  });

  it('tolerates a header-only presence and blank lines', () => {
    const out = 'Filesystem   1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on\n\n/dev/disk3s5   239362496 174665368  42192648    78% 2863304 421926480    1%   /System/Volumes/Data\n';
    expect(parseUsePct(out)).toBe(78);
  });

  it('picks the first data row in a multi-mount listing', () => {
    const out = [
      'Filesystem     1024-blocks      Used Available Capacity Mounted on',
      '/dev/sda1        500000000 400000000 100000000    80% /',
      '/dev/sdb1        500000000 250000000 250000000    50% /data',
    ].join('\n');
    expect(parseUsePct(out)).toBe(80);
  });

  it('returns null when the capacity cell is not an NN% shape', () => {
    // A locale or format change that breaks the shape must read as 'cannot
    // probe' (null → skip-not-fail), never as a made-up percentage.
    expect(parseUsePct('Filesystem  x  y  z  Capacity  Mounted\n')).toBeNull();
    expect(parseUsePct('')).toBeNull();
    expect(parseUsePct('  /dev/disk3s5  a  b  c  81%extra  /')).toBeNull();
  });
});

describe('resolveLimit · env override safety', () => {
  it('defaults to 90 when the env var is unset or blank', () => {
    expect(resolveLimit(undefined)).toBe(DEFAULT_DISK_LIMIT_PCT);
    expect(resolveLimit('')).toBe(DEFAULT_DISK_LIMIT_PCT);
    expect(DEFAULT_DISK_LIMIT_PCT).toBe(90);
  });

  it('honors a valid numeric override', () => {
    expect(resolveLimit('80')).toBe(80);
    expect(resolveLimit('95')).toBe(95);
  });

  it('falls back to 90 on a non-numeric or non-positive override (gate stays armed)', () => {
    // A typo'd override must not silently disable the gate: the comparison
    // would otherwise error and read as a pass.
    expect(resolveLimit('abc')).toBe(DEFAULT_DISK_LIMIT_PCT);
    expect(resolveLimit('0')).toBe(DEFAULT_DISK_LIMIT_PCT);
    expect(resolveLimit('-5')).toBe(DEFAULT_DISK_LIMIT_PCT);
    expect(resolveLimit('NaN')).toBe(DEFAULT_DISK_LIMIT_PCT);
  });
});

describe('resolveWarn · the 85% warning threshold', () => {
  it('defaults to 85 when the env var is unset or blank', () => {
    expect(resolveWarn(undefined)).toBe(DEFAULT_DISK_WARN_PCT);
    expect(resolveWarn('')).toBe(DEFAULT_DISK_WARN_PCT);
    expect(DEFAULT_DISK_WARN_PCT).toBe(85);
  });

  it('honors a valid numeric override', () => {
    expect(resolveWarn('80')).toBe(80);
    expect(resolveWarn('88')).toBe(88);
  });

  it('falls back to 85 on a non-numeric or non-positive override', () => {
    expect(resolveWarn('abc')).toBe(DEFAULT_DISK_WARN_PCT);
    expect(resolveWarn('0')).toBe(DEFAULT_DISK_WARN_PCT);
    expect(resolveWarn('-3')).toBe(DEFAULT_DISK_WARN_PCT);
  });
});

describe('probeUsePct · mount probing (injected df runner)', () => {
  it('returns { pct, mount } when df succeeds on the Data volume', () => {
    const runDf = (mount) => (mount === '/System/Volumes/Data' ? DF_OUT(81, mount) : '');
    expect(probeUsePct(runDf)).toEqual({ pct: 81, mount: '/System/Volumes/Data' });
  });

  it('falls back to the root mount when the Data volume probe fails (non-macOS)', () => {
    const runDf = (mount) => {
      if (mount === '/System/Volumes/Data') throw new Error('df: no such file');
      return DF_OUT(80, mount);
    };
    expect(probeUsePct(runDf)).toEqual({ pct: 80, mount: '/' });
  });

  it('returns null when every probe fails — the skip-not-fail input', () => {
    const runDf = () => {
      throw new Error('df: not found');
    };
    expect(probeUsePct(runDf)).toBeNull();
  });
});

describe('diskHeadroomVerdict · the exit-decision contract', () => {
  it('maps an unprobed result to skip (exit 0 — never fail when df is unavailable)', () => {
    expect(diskHeadroomVerdict({ probed: null, limit: 90 })).toEqual({ kind: 'skip' });
  });

  it('maps an over-limit probe to fail (exit 1) with the pct/mount/limit surfaced', () => {
    expect(diskHeadroomVerdict({ probed: { pct: 95, mount: '/System/Volumes/Data' }, limit: 90 })).toEqual({
      kind: 'fail',
      pct: 95,
      mount: '/System/Volumes/Data',
      limit: 90,
    });
  });

  it('maps an under-limit probe to pass (exit 0) without a warning', () => {
    expect(diskHeadroomVerdict({ probed: { pct: 78, mount: '/' }, limit: 90 })).toEqual({
      kind: 'pass',
      pct: 78,
      mount: '/',
      limit: 90,
      warn: false,
    });
  });

  it('passes AT the limit (strictly OVER fails — the "over 90%" contract)', () => {
    // Exactly at the hard limit passes (the -gt semantics), and since 90 also
    // crosses the default 85 warn threshold, the pass carries warn: true —
    // exactly-at-limit is both a pass AND a warning, which is the point of
    // the two-tier design.
    expect(diskHeadroomVerdict({ probed: { pct: 90, mount: '/System/Volumes/Data' }, limit: 90 })).toEqual({
      kind: 'pass',
      pct: 90,
      mount: '/System/Volumes/Data',
      limit: 90,
      warn: true,
    });
  });
});

describe('diskHeadroomVerdict · the non-blocking 85% warning tier', () => {
  it('warns (still pass, exit 0) when the pct crosses the warn threshold but is under the limit', () => {
    expect(diskHeadroomVerdict({ probed: { pct: 87, mount: '/System/Volumes/Data' }, limit: 90 })).toEqual({
      kind: 'pass',
      pct: 87,
      mount: '/System/Volumes/Data',
      limit: 90,
      warn: true,
    });
  });

  it('does NOT warn exactly AT the warn threshold (strictly-over semantics)', () => {
    expect(diskHeadroomVerdict({ probed: { pct: 85, mount: '/' }, limit: 90 })).toEqual({
      kind: 'pass',
      pct: 85,
      mount: '/',
      limit: 90,
      warn: false,
    });
  });

  it('honors a DISK_WARN_PCT override', () => {
    expect(diskHeadroomVerdict({ probed: { pct: 82, mount: '/' }, limit: 90, warnLimit: 80 })).toEqual({
      kind: 'pass',
      pct: 82,
      mount: '/',
      limit: 90,
      warn: true,
    });
  });

  it('never warns when the warn threshold sits at or above the hard limit (the limit governs)', () => {
    // With warnLimit 90 = limit 90, no value can cross the warn threshold and
    // still be a pass — the warning is unreachable by design.
    expect(diskHeadroomVerdict({ probed: { pct: 88, mount: '/' }, limit: 90, warnLimit: 90 })).toEqual({
      kind: 'pass',
      pct: 88,
      mount: '/',
      limit: 90,
      warn: false,
    });
  });
});
