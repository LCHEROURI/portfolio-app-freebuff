#!/usr/bin/env node
// ============================================================================
// scripts/maintain-conv-db.mjs — periodic WAL maintenance for the Freebuff
// conversation DB.
//
// WHY THIS EXISTS (the investigation, verified Aug 2026):
// The app's SQLite WAL file grows past the 1000-page wal_autocheckpoint
// threshold and never shrinks on its own. Root cause, confirmed with a
// controlled model: the app keeps a live connection that performs reads
// around its writes, and at commit time an open read transaction blocks the
// automatic PASSIVE checkpoint from RESETTING the WAL (the busy=1 case). The
// frames still get copied into the main DB — that is why the main DB stays a
// stable 48 MiB while the WAL file ratchets up to 4-5 MiB of mostly dead
// space. During idle gaps (no read transaction open) an external TRUNCATE
// succeeds instantly (busy=0) — so the WAL is never stuck, it just never gets
// truncated because nothing runs a truncating checkpoint at an idle moment.
//
// WHAT THIS DOES: a one-shot maintenance run. When the -wal sidecar exceeds a
// threshold (default 4 MiB ≈ the 1000-page auto-checkpoint boundary), it runs
// `PRAGMA wal_checkpoint(TRUNCATE)` — the exact operation that flushes the
// frames into the main DB and shrinks the -wal file to zero — with a short
// busy-retry loop (the app's read transaction only blocks momentarily, so an
// idle gap succeeds). This is the same checkpoint `verify:conv-db` proves;
// this script is the periodic shrinker that keeps the file bounded.
//
// Behavior contract (maintenance is best-effort, NOT a gate):
//   - exit 0 (SKIP)      — sqlite3 missing or the DB file absent
//   - exit 0 (idle)      — WAL ≤ threshold, nothing to do (a pure stat, no
//     sqlite3 spawn — the common case on a 10-minute tick)
//   - exit 0 (truncated) — TRUNCATE succeeded (busy=0), WAL file shrunk
//   - exit 0 (busy)      — the app held a read txn across all retries; the
//     frames are safe (they stay in the WAL), it will retry on the next run
//   - exit 1 (error)     — a genuine sqlite failure or an unreadable
//     checkpoint result (never a silent pass)
// The threshold / retry knobs are env-overridable so a tighter schedule can
// reclaim more aggressively: CONV_DB_MAINTAIN_THRESHOLD (bytes),
// CONV_DB_MAINTAIN_RETRIES, CONV_DB_MAINTAIN_RETRY_DELAY (ms) — flags win.
//
// Usage:
//   npm run maintain:conv-db
//   CONV_DB_MAINTAIN_THRESHOLD=8388608 node scripts/maintain-conv-db.mjs
//   node scripts/maintain-conv-db.mjs --db /tmp/other.db --threshold 4194304
//   node scripts/maintain-conv-db.mjs --retries 5 --retry-delay 3000
//
// Exports (for the unit test): parseMaintainArgs, maintainVerdict,
// runMaintenance, DEFAULT_DB_PATH. The sqlite-parsing / path / size helpers
// are SHARED with verify-conv-db.mjs (parseCheckpoint, parseIntegrity,
// resolveDbPath, walBytes, formatBytes) so the two conv-db scripts cannot
// drift. runMaintenance takes the sqlite runner / stat / sleep as injectable
// arguments (default: the real sqlite3 CLI + fs + timers) so every branch is
// lockable with fake runners and no built-in mocking.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  formatBytes,
  parseCheckpoint,
  parseIntegrity,
  resolveDbPath,
  walBytes,
} from './verify-conv-db.mjs';

export const DEFAULT_DB_PATH = '.freebuff/desktop-v2.db';
const DEFAULT_THRESHOLD = 4 * 1024 * 1024; // 4 MiB ≈ the 1000-page boundary
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;

/** Parse flags/env; invalid numbers fall back to the defaults. */
export function parseMaintainArgs(argv = process.argv, env = process.env) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : undefined;
  };
  const num = (v, dflt) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : dflt);
  return {
    dbPath: resolveDbPath(env, flag('--db')),
    threshold: num(flag('--threshold'), num(env.CONV_DB_MAINTAIN_THRESHOLD, DEFAULT_THRESHOLD)),
    retries: Math.floor(num(flag('--retries'), num(env.CONV_DB_MAINTAIN_RETRIES, DEFAULT_RETRIES))),
    retryDelayMs: num(flag('--retry-delay'), num(env.CONV_DB_MAINTAIN_RETRY_DELAY, DEFAULT_RETRY_DELAY_MS)),
  };
}

/**
 * The pure skip/idle decision. runMaintenance supplies the inputs; the busy /
 * truncated / error outcomes come from the checkpoint loop itself:
 *   { kind: 'skip' }            — sqlite3 missing or DB absent
 *   { kind: 'idle', walBefore } — WAL ≤ threshold, nothing to do
 *   null                        — WAL above threshold → run the checkpoint loop
 */
export function maintainVerdict({
  sqliteAvailable = true,
  dbExists = true,
  walBefore = 0,
  threshold = DEFAULT_THRESHOLD,
}) {
  if (!sqliteAvailable || !dbExists) return { kind: 'skip' };
  if (walBefore <= threshold) return { kind: 'idle', walBefore, threshold };
  return null; // above threshold → the caller runs the checkpoint loop
}

const runSqlite = (dbPath, sql) => execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8' }).trim();

/**
 * One maintenance run. Returns:
 *   { kind: 'skip' } | { kind: 'idle', … } | { kind: 'truncated', walBefore,
 *   walAfter, checkpoint, attempts } | { kind: 'busy', walBefore, walAfter,
 *   checkpoint, attempts } | { kind: 'error', reason, attempts, walBefore }
 * The WAL size is checked BEFORE any sqlite spawn, so the common idle tick is
 * a pure stat; the availability probe runs only when there is something to
 * truncate. The checkpoint loop retries on busy (the app's read txn blocks
 * only momentarily); a non-busy sqlite error or an unreadable result stops
 * immediately and fails.
 */
export async function runMaintenance(dbPath, opts = {}) {
  const {
    threshold = DEFAULT_THRESHOLD,
    retries = DEFAULT_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    runSqliteImpl = runSqlite,
    statImpl = statSync,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = opts;

  if (!existsSync(dbPath)) return maintainVerdict({ dbExists: false });

  // WAL size first: a WAL at/below the threshold means there is nothing to do,
  // and sqlite3 is never spawned for an idle tick.
  const walBefore = walBytes(dbPath, statImpl);
  const idle = maintainVerdict({ dbExists: true, sqliteAvailable: true, walBefore, threshold });
  if (idle) return idle;

  // Availability probe (mirrors runProof): ENOENT = sqlite3 missing → skip;
  // any other error = the DB exists but is broken → fail loudly.
  try {
    parseIntegrity(runSqliteImpl(dbPath, 'PRAGMA integrity_check;'));
  } catch (err) {
    if (err?.code === 'ENOENT') return maintainVerdict({ sqliteAvailable: false });
    return { kind: 'error', reason: err instanceof Error ? err.message : String(err), attempts: 0, walBefore };
  }

  let checkpoint = { busy: -1, log: -1, checkpointed: -1 };
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      checkpoint = parseCheckpoint(runSqliteImpl(dbPath, 'PRAGMA wal_checkpoint(TRUNCATE);'));
    } catch (err) {
      return {
        kind: 'error',
        reason: err instanceof Error ? err.message : String(err),
        attempts: attempt,
        walBefore,
      };
    }
    // busy < 0 is the sentinel for an unreadable result — that is an error,
    // never a "the app is reading" deferral.
    if (checkpoint.busy < 0) {
      return {
        kind: 'error',
        reason: `unreadable checkpoint result (busy=${checkpoint.busy}, log=${checkpoint.log}, checkpointed=${checkpoint.checkpointed})`,
        attempts: attempt,
        walBefore,
      };
    }
    if (checkpoint.busy === 0) {
      const walAfter = walBytes(dbPath, statImpl);
      return { kind: 'truncated', walBefore, walAfter, checkpoint, attempts: attempt };
    }
    if (attempt < retries) await sleep(retryDelayMs);
  }

  const walAfter = walBytes(dbPath, statImpl);
  return { kind: 'busy', walBefore, walAfter, checkpoint, attempts: retries };
}

async function main() {
  const { dbPath, threshold, retries, retryDelayMs } = parseMaintainArgs();
  console.log(`Freebuff conversation DB WAL maintenance (${dbPath}) — threshold ${formatBytes(threshold)}`);
  const result = await runMaintenance(dbPath, { threshold, retries, retryDelayMs });

  if (result.kind === 'skip') {
    console.log('  — cannot maintain — sqlite3 unavailable or DB file missing (skip-not-fail)');
    console.log('RESULT: SKIPPED');
    process.exit(0);
  }
  if (result.kind === 'idle') {
    console.log(`  ✓ WAL at ${formatBytes(result.walBefore)} — at or below the ${formatBytes(result.threshold)} threshold, nothing to do`);
    console.log('RESULT: PASS (idle)');
    process.exit(0);
  }
  if (result.kind === 'error') {
    console.error(`  ✗ FAIL: ${result.reason}`);
    console.error('  The checkpoint could not run — check disk headroom (verify:disk-headroom) and sqlite integrity.');
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  if (result.kind === 'truncated') {
    const { checkpoint } = result;
    console.log(`  ✓ TRUNCATE flushed the WAL: ${formatBytes(result.walBefore)} → ${formatBytes(result.walAfter)} (busy=${checkpoint.busy}, log=${checkpoint.log}, checkpointed=${checkpoint.checkpointed}) on attempt ${result.attempts}/${retries}`);
    console.log('RESULT: PASS (truncated)');
    process.exit(0);
  }
  const { checkpoint } = result;
  console.log(`  ⚠ WAL still busy after ${result.attempts} attempts (busy=${checkpoint.busy}, ${formatBytes(result.walAfter)} remain) — the app holds a read transaction; safe in the WAL, will retry on the next run`);
  console.log('RESULT: PASS (deferred)');
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`  ✗ FAIL: ${err instanceof Error ? err.message : String(err)}`);
    console.error('RESULT: FAIL');
    process.exit(1);
  });
}
