#!/usr/bin/env node
// ============================================================================
// scripts/verify-disk-headroom.mjs — prove the machine has disk headroom.
//
// The disk at 90% was the root cause of the Freebuff app's SQLite "disk I/O
// error" on button clicks (its conversation DB writes on every click), and a
// full disk silently breaks the Chrome /tmp profiles and npm steps the other
// gates depend on. This gate reads the Data volume's use% from `df` and fails
// when it exceeds DISK_LIMIT_PCT (default 90), so a full disk is caught in
// milliseconds instead of after a 20-minute ship:ready run.
//
// Behavior contract (the same skip-not-fail convention every gate follows):
//   - exit 0  → the probed volume is under the limit (PASS), OR `df` is
//     unavailable on every probed mount (SKIP with a notice — a machine
//     without df cannot know its headroom, so the run proceeds, never fails).
//   - exit 1  → the probed volume exceeds DISK_LIMIT_PCT (FAIL), with the
//     free-space guidance in the message.
// DISK_LIMIT_PCT is env-overridable; a malformed (non-numeric) value falls
// back to the 90 default so the gate can never be silently disabled by a
// typo (a non-numeric comparison would otherwise error and read as a pass).
//
// Local-only by design: it checks the MACHINE the gate runs on, so it is
// deliberately NOT wired into CI (a runner's disk is not the developer's).
// Shared surface: the pre-push hook (gate 0.05), `npm run verify:disk-
// headroom`, verify:all's summary table, and docs/launch.md §4 all run this
// ONE script — no bash/node drift.
//
// Usage:
//   npm run verify:disk-headroom            # against the default 90% limit
//   DISK_LIMIT_PCT=80 node scripts/verify-disk-headroom.mjs
//
// Exports (for the unit test): parseUsePct, resolveLimit, probeUsePct,
// diskHeadroomVerdict, DEFAULT_DISK_LIMIT_PCT. probeUsePct takes the df
// runner as an injectable argument (default: execFileSync) so the unit test
// can exercise every mount-failure path without mocking node built-ins.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DISK_LIMIT_PCT = 90;

// The mounts probed in order: the macOS Data volume first (where the app DB
// and user data live), then the root mount (the non-macOS fallback — and the
// only sensible mount when /System/Volumes/Data does not exist).
const PROBE_MOUNTS = ['/System/Volumes/Data', '/'];

/**
 * Parse the use% (Capacity) column out of `df -k` output. Returns the integer
 * percent, or null when no data row is found. Robust by construction: it
 * scans every line for a whitespace field that looks like `NN%` — the data
 * row's Capacity column — so a header line of any name, a locale quirk, or a
 * multi-mount listing can never produce a bogus value (an unrecognized shape
 * simply returns null, which callers treat as 'cannot probe').
 */
export function parseUsePct(stdout) {
  for (const line of String(stdout).split('\n')) {
    const fields = line.trim().split(/\s+/);
    const cell = fields[4];
    if (cell && /^\d+%$/.test(cell)) {
      const n = Number(cell.replace('%', ''));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Resolve the DISK_LIMIT_PCT override. The env value is a string; a blank or
 * non-numeric value (e.g. a typo'd `DISK_LIMIT_PCT=abc`) falls back to the 90
 * default so the gate stays armed — never silently disabled.
 */
export function resolveLimit(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DISK_LIMIT_PCT;
}

/**
 * The default df runner: `df -k <mount>`. Kept as its own const so the unit
 * test can inject a fake runner into probeUsePct (no built-in mocking).
 */
const runDf = (mount) => execFileSync('df', ['-k', mount], { encoding: 'utf8' });

/**
 * Probe the first mount `df` can read and return { pct, mount }, or null when
 * every mount fails (df missing or no data row parseable). Each probe is
 * independent — a failing mount (e.g. the macOS-only path on Linux) falls
 * through to the next. runDfImpl is injectable for tests (returns df stdout
 * or throws); the CLI always uses the real runDf.
 */
export function probeUsePct(runDfImpl = runDf) {
  for (const mount of PROBE_MOUNTS) {
    try {
      const out = runDfImpl(mount);
      const pct = parseUsePct(out);
      if (pct !== null) return { pct, mount };
    } catch {
      // df failed for this mount (missing path / no df binary) — try the next.
    }
  }
  return null;
}

/**
 * The pure exit decision, extracted from main() so the skip-not-fail and
 * over-limit contracts are unit-testable. Returns a verdict the CLI renders:
 *   { kind: 'skip' }                              — nothing probed (df unavailable)
 *   { kind: 'fail', pct, mount, limit }           — over the limit (exit 1)
 *   { kind: 'pass', pct, mount, limit }           — under the limit (exit 0)
 * Boundary: strictly OVER the limit fails; exactly AT the limit passes (the
 * gate guards "over 90% full", matching the hook's original -gt comparison).
 */
export function diskHeadroomVerdict({ probed, limit }) {
  if (!probed) return { kind: 'skip' };
  if (probed.pct > limit) {
    return { kind: 'fail', pct: probed.pct, mount: probed.mount, limit };
  }
  return { kind: 'pass', pct: probed.pct, mount: probed.mount, limit };
}

function main() {
  const limit = resolveLimit(process.env.DISK_LIMIT_PCT);
  const verdict = diskHeadroomVerdict({ probed: probeUsePct(), limit });

  if (verdict.kind === 'skip') {
    console.log('disk headroom: df unavailable on every probed mount — skipping (cannot know headroom; skip-not-fail)');
    console.log('RESULT: SKIPPED');
    process.exit(0);
  }
  if (verdict.kind === 'fail') {
    console.error(`✗ FAIL: ${verdict.mount} is ${verdict.pct}% full (limit ${verdict.limit}%) — a full disk causes SQLite I/O errors and breaks the verifiers.`);
    console.error('  Free space (clear caches / empty Trash / delete ~/Library/Application Support/com.google.AIEdgeEloquent), then re-run.');
    console.error('RESULT: FAIL');
    process.exit(1);
  }

  console.log(`disk headroom: ${verdict.mount} at ${verdict.pct}% used (limit ${verdict.limit}%) ✓`);
  console.log('RESULT: PASS');
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
