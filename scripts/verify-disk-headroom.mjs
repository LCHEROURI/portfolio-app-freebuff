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
// Two tiers, so a creeping disk is surfaced EARLY and only the true emergency
// blocks the push:
//   - WARN  → the probed volume crosses DISK_WARN_PCT (default 85) but is
//     still under the limit: the run PASSES (exit 0) but prints a warning
//     telling you to free space before the disk hits the hard limit.
//   - FAIL  → the probed volume exceeds DISK_LIMIT_PCT (exit 1), with the
//     free-space guidance in the message.
// Behavior contract (the same skip-not-fail convention every gate follows):
//   - exit 0  → the probed volume is under the limit (PASS, possibly with a
//     warning), OR `df` is unavailable on every probed mount (SKIP with a
//     notice — a machine without df cannot know its headroom, so the run
//     proceeds, never fails).
//   - exit 1  → the probed volume exceeds DISK_LIMIT_PCT (FAIL).
// DISK_LIMIT_PCT and DISK_WARN_PCT are env-overridable; a malformed
// (non-numeric) value falls back to the default so the gate can never be
// silently disabled by a typo (a non-numeric comparison would otherwise
// error and read as a pass). If DISK_WARN_PCT is set at or above
// DISK_LIMIT_PCT, the warning simply never fires — the hard limit already
// governs every value above it.
//
// Local-only by design: it checks the MACHINE the gate runs on, so it is
// deliberately NOT wired into CI (a runner's disk is not the developer's).
// Shared surface: the pre-push hook (gate 0.05), `npm run verify:disk-
// headroom`, verify:all's summary table, and docs/launch.md §4 all run this
// ONE script — no bash/node drift.
//
// Usage:
//   npm run verify:disk-headroom            # default 85% warn / 90% limit
//   DISK_LIMIT_PCT=80 node scripts/verify-disk-headroom.mjs
//   DISK_WARN_PCT=80 node scripts/verify-disk-headroom.mjs   # warn earlier
//
// Exports (for the unit test): parseUsePct, resolveLimit, resolveWarn,
// probeUsePct, diskHeadroomVerdict, DEFAULT_DISK_LIMIT_PCT,
// DEFAULT_DISK_WARN_PCT. probeUsePct takes the df runner as an injectable
// argument (default: execFileSync) so the unit test can exercise every
// mount-failure path without mocking node built-ins.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DISK_LIMIT_PCT = 90;
export const DEFAULT_DISK_WARN_PCT = 85;

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
 * Shared numeric-guard: parse an env percentage override, falling back to the
 * given default when the value is blank or non-numeric, so a typo'd override
 * can never silently disarm a threshold.
 */
function resolvePct(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Resolve the DISK_LIMIT_PCT override (default 90). */
export function resolveLimit(raw) {
  return resolvePct(raw, DEFAULT_DISK_LIMIT_PCT);
}

/** Resolve the DISK_WARN_PCT override (default 85). */
export function resolveWarn(raw) {
  return resolvePct(raw, DEFAULT_DISK_WARN_PCT);
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
 * The pure exit decision, extracted from main() so the skip-not-fail, warn,
 * and over-limit contracts are unit-testable. Returns a verdict the CLI
 * renders:
 *   { kind: 'skip' }                                   — nothing probed (df
 *     unavailable)
 *   { kind: 'fail', pct, mount, limit }                — over the limit (exit 1)
 *   { kind: 'pass', pct, mount, limit, warn }          — under the limit (exit
 *     0); warn is true when the pct ALSO crosses the warn threshold (still a
 *     pass — the warning is non-blocking)
 * Boundary: strictly OVER the limit fails; exactly AT the limit passes (the
 * gate guards "over 90% full", matching the hook's original -gt comparison).
 * Same strictly-over semantics for the warn tier: exactly AT the warn
 * threshold is not warned.
 */
export function diskHeadroomVerdict({ probed, limit, warnLimit = DEFAULT_DISK_WARN_PCT }) {
  if (!probed) return { kind: 'skip' };
  if (probed.pct > limit) {
    return { kind: 'fail', pct: probed.pct, mount: probed.mount, limit };
  }
  return {
    kind: 'pass',
    pct: probed.pct,
    mount: probed.mount,
    limit,
    warn: probed.pct > warnLimit,
  };
}

function main() {
  const limit = resolveLimit(process.env.DISK_LIMIT_PCT);
  const warnLimit = resolveWarn(process.env.DISK_WARN_PCT);
  const verdict = diskHeadroomVerdict({ probed: probeUsePct(), limit, warnLimit });

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
  if (verdict.warn) {
    // Non-blocking warning: the push still proceeds, but the disk is crossing
    // the early threshold — surface it so space gets freed BEFORE the hard
    // 90% limit silently starts breaking SQLite writes and the verifiers.
    console.log(`  ⚠ WARNING: over the ${warnLimit}% warn threshold — free space (clear caches / empty Trash) before it reaches ${verdict.limit}%`);
  }
  console.log('RESULT: PASS');
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
