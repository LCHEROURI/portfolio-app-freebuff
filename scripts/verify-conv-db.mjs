#!/usr/bin/env node
// ============================================================================
// scripts/verify-conv-db.mjs — prove the Freebuff conversation DB writes
// cleanly.
//
// The disk at 90% was the root cause of the Freebuff app's SQLite "disk I/O
// error" on button clicks (its conversation DB writes on every click), so a
// full disk silently broke the app's own store. This gate is the write-path
// proof: it runs the exact cycle the app performs on every click — commit a
// write, flush it from the WAL into the main DB, verify integrity — against
// the REAL conversation DB (via a scratch table, dropped at the end, zero
// trace).
//
// Steps, in order:
//   1. PRAGMA integrity_check before.
//   2. Force a real WAL-frame write cycle: create a scratch table, insert a
//      row, commit, read it back (rows=1 must survive).
//   3. PRAGMA wal_checkpoint(TRUNCATE) — flush the WAL frames into the main
//      DB and truncate the -wal file to zero (the exact operation that threw
//      "disk I/O error" at 90%).
//   4. PRAGMA integrity_check after.
// The scratch table is always dropped (finally), so a failed run never leaves
// residue in the app's live DB.
//
// Behavior contract (the same skip-not-fail convention every gate follows):
//   - exit 0  → PASS: integrity ok before/after, the committed row survived,
//     and (in WAL mode) the -wal file ended at 0 bytes after the TRUNCATE
//     checkpoint. A busy checkpoint (the app actively holding a read lock)
//     still passes with a WARNING — writes are proven by the row survival and
//     integrity; the flush just needs the app idle.
//   - exit 1  → FAIL: integrity error, the row did not survive, the WAL was
//     not truncated, or sqlite3 errored.
//   - exit 0 (SKIP) → sqlite3 missing, or the DB file does not exist: the
//     proof cannot run, so it skips-not-fails with a notice.
//
// Env: CONV_DB_PATH overrides the conversation DB path (default
// .freebuff/desktop-v2.db); --db <path> wins over the env var. The sqlite3
// CLI ships with macOS — this is a local machine check (like
// verify-disk-headroom) and is deliberately never wired into CI.
//
// Usage:
//   npm run verify:conv-db
//   CONV_DB_PATH=/tmp/other.db node scripts/verify-conv-db.mjs
//   node scripts/verify-conv-db.mjs --db /tmp/other.db
//
// Exports (for the unit test): parseIntegrity, parseJournal, parseCheckpoint,
// resolveDbPath, walBytes, convDbVerdict, runProof, DEFAULT_DB_PATH.
// runProof takes the sqlite runner as an injectable argument (default:
// execFileSync('sqlite3', …)) so every step of the cycle is lockable with
// fake runners and no built-in mocking — the same pattern as
// verify-disk-headroom's probeUsePct.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DB_PATH = '.freebuff/desktop-v2.db';
const SCRATCH_TABLE = '_disk_proof';

/** Trim the sqlite3 stdout for a scalar pragma (integrity_check / journal_mode). */
export function parseIntegrity(stdout) {
  return String(stdout).trim();
}

/** Trim the sqlite3 stdout for `PRAGMA journal_mode;`. */
export function parseJournal(stdout) {
  return String(stdout).trim();
}

/**
 * Parse the `wal_checkpoint` result row `busy|log|checkpointed`. Non-numeric
 * cells read as -1 (sentinel) so a malformed row can never be misread as a
 * clean zero-byte flush.
 */
export function parseCheckpoint(stdout) {
  const [busy, log, checkpointed] = String(stdout).trim().split('|').map((n) => Number(n));
  return {
    busy: Number.isFinite(busy) ? busy : -1,
    log: Number.isFinite(log) ? log : -1,
    checkpointed: Number.isFinite(checkpointed) ? checkpointed : -1,
  };
}

/** Resolve the DB path: --db flag wins, then CONV_DB_PATH, then the default. */
export function resolveDbPath(env = process.env, flagValue) {
  return flagValue || env.CONV_DB_PATH || DEFAULT_DB_PATH;
}

/** The -wal sidecar's size in bytes; 0 when absent (an empty WAL is 0 bytes). */
export function walBytes(dbPath, statImpl = statSync) {
  try {
    return statImpl(`${dbPath}-wal`).size;
  } catch {
    return 0;
  }
}

/**
 * The pure exit decision. Inputs come from the real run in main() (or from a
 * fake runner in the tests):
 *   { sqliteAvailable, dbExists, integrityBefore, integrityAfter, rows,
 *     journalMode, checkpoint, walBytesAfter }
 * Returns the verdict the CLI renders:
 *   { kind: 'skip' }                              — sqlite3 missing or DB absent
 *     (cannot run the proof — skip, never fail)
 *   { kind: 'fail', reason }                      — integrity error, row lost,
 *     or WAL not truncated (exit 1)
 *   { kind: 'warn', reason, … }                   — pass (exit 0) with a
 *     notice: a busy checkpoint left WAL frames while the app actively holds
 *     a read lock — writes are still proven, the flush just needs it idle
 *   { kind: 'pass', … }                           — every step clean
 * WAL truncation is asserted only in WAL mode; a non-WAL journal proves the
 * commit path via row survival + integrity and reports the mode in the pass.
 */
export function convDbVerdict({
  sqliteAvailable = true,
  dbExists = true,
  integrityBefore = 'ok',
  integrityAfter = 'ok',
  rows = 1,
  journalMode = 'wal',
  checkpoint = { busy: 0, log: 0, checkpointed: 0 },
  walBytesAfter = 0,
}) {
  if (!sqliteAvailable || !dbExists) return { kind: 'skip' };

  const issues = [];
  if (integrityBefore !== 'ok') issues.push(`integrity before = ${JSON.stringify(integrityBefore)}`);
  if (integrityAfter !== 'ok') issues.push(`integrity after = ${JSON.stringify(integrityAfter)}`);
  if (issues.length > 0) return { kind: 'fail', reason: issues.join('; ') };

  if (rows !== 1) {
    return { kind: 'fail', reason: `scratch write not readable back (rows=${rows}, expected 1)` };
  }

  if (journalMode === 'wal' && walBytesAfter > 0) {
    if (checkpoint.busy > 0) {
      return {
        kind: 'warn',
        reason: `checkpoint busy (busy=${checkpoint.busy}) — WAL still holds ${walBytesAfter} bytes; the app is actively writing (healthy), flush when idle`,
        walBytesAfter,
      };
    }
    return {
      kind: 'fail',
      reason: `WAL not truncated after checkpoint (${walBytesAfter} bytes remain)`,
    };
  }

  return {
    kind: 'pass',
    journalMode,
    checkpoint,
    walBytesAfter,
    walAsserted: journalMode === 'wal',
  };
}

/** The default sqlite runner: the macOS sqlite3 CLI, one statement, stdout. */
const runSqlite = (dbPath, sql) =>
  execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8' }).trim();

/**
 * Run the full write-cycle proof against a real DB path. runSqliteImpl is
 * injectable for tests (returns sqlite stdout or throws, like
 * verify-disk-headroom's runDfImpl); statImpl is injectable for walBytes. The
 * scratch table is ALWAYS dropped in a finally, so a mid-run failure never
 * leaves residue in the app's live DB. Returns a convDbVerdict verdict.
 */
export function runProof(dbPath, runSqliteImpl = runSqlite, statImpl = statSync) {
  // DB presence FIRST: a missing DB must skip (nothing to prove) — and probing
  // a nonexistent path with the sqlite3 CLI would silently CREATE an empty
  // DB, which must never happen.
  if (!existsSync(dbPath)) {
    return convDbVerdict({ dbExists: false });
  }
  // The first integrity check doubles as the availability probe. ENOENT = the
  // sqlite3 binary is missing → skip-not-fail. ANY other error (e.g. "file is
  // not a database") is a genuine integrity failure — the DB exists but is
  // broken — so it must FAIL, never read as a pass. On success the parsed
  // result IS integrityBefore (one scan, not two).
  let integrityBefore;
  try {
    integrityBefore = parseIntegrity(runSqliteImpl(dbPath, 'PRAGMA integrity_check;'));
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return convDbVerdict({ sqliteAvailable: false });
    }
    return convDbVerdict({
      integrityBefore: err instanceof Error ? err.message : String(err),
      integrityAfter: 'ok',
    });
  }

  let journalMode = 'wal';
  let rows = 1;
  let checkpoint = { busy: 0, log: 0, checkpointed: 0 };
  let integrityAfter = 'ok';

  try {
    journalMode = parseJournal(runSqliteImpl(dbPath, 'PRAGMA journal_mode;'));
    // 2. The forced write cycle: scratch table + committed row (WAL frames).
    runSqliteImpl(
      dbPath,
      `DROP TABLE IF EXISTS ${SCRATCH_TABLE}; `
        + `CREATE TABLE ${SCRATCH_TABLE} (id INTEGER PRIMARY KEY, payload TEXT); `
        + `INSERT INTO ${SCRATCH_TABLE} (payload) VALUES ('conv-db-write-proof');`,
    );
    rows = Number(runSqliteImpl(dbPath, `SELECT count(*) FROM ${SCRATCH_TABLE};`));
    // 3. Flush the frames into the main DB and truncate the WAL.
    checkpoint = parseCheckpoint(runSqliteImpl(dbPath, 'PRAGMA wal_checkpoint(TRUNCATE);'));
  } catch (err) {
    return { kind: 'fail', reason: err instanceof Error ? err.message : String(err) };
  } finally {
    // Zero trace: drop the scratch table and reset the WAL, best-effort.
    try {
      runSqliteImpl(dbPath, `DROP TABLE IF EXISTS ${SCRATCH_TABLE}; PRAGMA wal_checkpoint(TRUNCATE);`);
    } catch {
      // Cleanup is best-effort; the verdict already carries the real failure.
    }
  }

  const walAfter = walBytes(dbPath, statImpl);
  try {
    integrityAfter = parseIntegrity(runSqliteImpl(dbPath, 'PRAGMA integrity_check;'));
  } catch (err) {
    return { kind: 'fail', reason: err instanceof Error ? err.message : String(err) };
  }

  return convDbVerdict({
    integrityBefore,
    integrityAfter,
    rows,
    journalMode,
    checkpoint,
    walBytesAfter: walAfter,
  });
}

function main() {
  const flagIdx = process.argv.indexOf('--db');
  const flagValue = flagIdx >= 0 ? process.argv[flagIdx + 1] : undefined;
  const dbPath = resolveDbPath(process.env, flagValue);
  const verdict = runProof(dbPath);

  console.log(`Freebuff conversation DB write proof (${dbPath})`);
  if (verdict.kind === 'skip') {
    console.log('  — cannot run the proof — sqlite3 unavailable or DB file missing (skip-not-fail)');
    console.log('RESULT: SKIPPED');
    process.exit(0);
  }
  if (verdict.kind === 'fail') {
    console.error(`  ✗ FAIL: ${verdict.reason}`);
    console.error('  The conversation DB write path is broken — check disk headroom (verify:disk-headroom) and sqlite integrity, then re-run.');
    console.error('RESULT: FAIL');
    process.exit(1);
  }

  const { checkpoint, journalMode, walBytesAfter, walAsserted } = verdict;
  if (walAsserted) {
    console.log(`  ✓ WAL checkpoint flushed — WAL at ${walBytesAfter} bytes (busy=${checkpoint.busy}, log=${checkpoint.log}, checkpointed=${checkpoint.checkpointed})`);
  } else {
    console.log(`  ✓ commit + integrity proven (journal mode ${journalMode} — WAL truncation not asserted)`);
  }
  if (verdict.kind === 'warn') {
    console.log(`  ⚠ WARNING: ${verdict.reason}`);
  }
  console.log('RESULT: PASS');
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
