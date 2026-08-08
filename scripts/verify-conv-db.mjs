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
//   npm run verify:conv-db:watch           # steady-state observation
//   CONV_DB_PATH=/tmp/other.db node scripts/verify-conv-db.mjs
//   node scripts/verify-conv-db.mjs --db /tmp/other.db
//   node scripts/verify-conv-db.mjs --watch --interval 5 --duration 60
//
// WATCH MODE (--watch): passively samples the -wal sidecar and main DB file
// sizes on an interval (default 15s, flag --interval <sec> / env
// CONV_DB_WATCH_INTERVAL) for a window (default 180s, flag --duration <sec> /
// env CONV_DB_WATCH_DURATION) and reports steady-state write behavior: WAL
// growth between samples (write activity, throughput in bytes/min), flush
// events (a WAL shrink — auto-checkpoint or connection close flushing frames
// into the main DB), the peak WAL, and a note when the WAL crosses the
// wal_autocheckpoint page threshold without a flush (deferred — the app holds
// an open reader). It never writes to the DB: pure file-size observation, so
// it is safe to run while the app is open. Exits 0 on a completed watch;
// exits 0 (SKIP) if the DB is absent.
//
// Exports (for the unit test): parseIntegrity, parseJournal, parseCheckpoint,
// resolveDbPath, walBytes, convDbVerdict, runProof, formatBytes,
// parseWatchArgs, detectEvent, runWatch, DEFAULT_DB_PATH. runProof and
// runWatch take their sqlite runner / sample / timer dependencies as
// injectable arguments (default: execFileSync('sqlite3', …) / real fs + real
// timers) so every step is lockable with fake runners and no built-in
// mocking — the same pattern as verify-disk-headroom's probeUsePct.
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

/** Human sizes: 0 → "0 B", 4096 → "4.0 KiB", 50,475,008 → "48.1 MiB". */
export function formatBytes(n) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = n;
  let unit = 0;
  while (Math.abs(value) >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value === 0 ? '0' : value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Parse the watch-mode flags/env. Invalid values (zero, negative, NaN) fall
 * back to the defaults — the same guard the disk-headroom env overrides use.
 */
export function parseWatchArgs(argv = process.argv, env = process.env) {
  const flagValue = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : undefined;
  };
  const clean = (v, dflt) => (Number.isFinite(v) && v > 0 ? v : dflt);
  const envInterval = env.CONV_DB_WATCH_INTERVAL ? Number(env.CONV_DB_WATCH_INTERVAL) : undefined;
  const envDuration = env.CONV_DB_WATCH_DURATION ? Number(env.CONV_DB_WATCH_DURATION) : undefined;
  const intervalSec = clean(flagValue('--interval') ?? envInterval, 15);
  const durationSec = clean(flagValue('--duration') ?? envDuration, 180);
  return { intervalSec, durationSec, intervalMs: intervalSec * 1000, durationMs: durationSec * 1000 };
}

/**
 * Classify one sample pair: WAL growth (write activity), a WAL shrink (a
 * flush event — auto-checkpoint or connection close pushing frames into the
 * main DB), and the main-DB delta. Pure, so it is fully lockable.
 */
export function detectEvent(prev, curr) {
  const walDelta = curr.wal - prev.wal;
  const prevMain = prev.main ?? 0;
  const mainDelta = (curr.main ?? prevMain) - prevMain;
  return {
    walDelta,
    mainDelta,
    walGrew: walDelta > 0,
    walShrank: walDelta < 0,
    checkpoint: walDelta < 0,
  };
}

/** Default watch sample: the -wal sidecar + main DB file sizes (0 / null when absent). */
const defaultSample = (dbPath) => {
  try {
    return { wal: walBytes(dbPath), main: existsSync(dbPath) ? statSync(dbPath).size : null };
  } catch {
    return { wal: 0, main: null };
  }
};

/** One-time read-only baseline pragmas (page_size / wal_autocheckpoint / journal_mode). */
const defaultPragmas = (dbPath) => {
  try {
    // -readonly: the watch claims to never write, and these pragma calls must
    // honor that — a read-write open could create/touch the -shm sidecar in
    // WAL mode. -readonly keeps even that sidecar untouched.
    const readOnlySqlite = (sql) => execFileSync('sqlite3', ['-readonly', dbPath, sql], { encoding: 'utf8' }).trim();
    const pageSize = Number(readOnlySqlite('PRAGMA page_size;'));
    const autocheckpointPages = Number(readOnlySqlite('PRAGMA wal_autocheckpoint;'));
    const journalMode = parseJournal(readOnlySqlite('PRAGMA journal_mode;'));
    return {
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : undefined,
      autocheckpointPages: Number.isFinite(autocheckpointPages) && autocheckpointPages > 0 ? autocheckpointPages : undefined,
      journalMode: journalMode || undefined,
    };
  } catch {
    return {}; // sqlite3 unavailable — file-size sampling still works
  }
};

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

/**
 * The passive steady-state observer. Samples WAL/main sizes every intervalMs
 * for durationMs (real timers + real fs by default) and logs each sample with
 * write-growth / flush-event markers, then a summary (throughput, flush
 * events, peak WAL, final state). Every dependency is injectable for tests
 * (sample, pragmas, sleep, log, now) — the same pattern as runProof. Returns
 * { kind: 'skip' } when the DB is absent, else { kind: 'ok', samples, … }.
 */
export async function runWatch(dbPath, opts = {}) {
  const {
    intervalMs = 15000,
    durationMs = 180000,
    sample = defaultSample,
    pragmas = defaultPragmas,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = (line) => console.log(line),
    now = () => Date.now(),
  } = opts;

  if (!existsSync(dbPath)) return { kind: 'skip' };

  const info = pragmas(dbPath);
  const pageSize = info.pageSize ?? 4096;
  const started = now();
  const stamp = (ms) => (
    `t+${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`
  );

  const baseline = ['  baseline:'];
  if (info.journalMode) baseline.push(`journal_mode=${info.journalMode}`);
  if (info.pageSize) baseline.push(`page_size=${info.pageSize}`);
  if (info.autocheckpointPages) {
    baseline.push(`wal_autocheckpoint=${info.autocheckpointPages} pages (~${formatBytes(info.autocheckpointPages * pageSize)})`);
  }
  if (baseline.length === 1) baseline.push('sqlite3 unavailable — file-size sampling only');
  log(baseline.join(' · '));

  let prev = sample(dbPath);
  let peakWal = prev.wal;
  let totalWalDelta = 0;
  const flushEvents = [];
  let samples = 1;
  let finalWal = prev.wal;
  let finalMain = prev.main;

  log(`  ${stamp(0)}  WAL ${formatBytes(prev.wal)} (${Math.round(prev.wal / pageSize)}p) · main ${prev.main === null ? '—' : formatBytes(prev.main)}`);

  while (now() - started < durationMs) {
    await sleep(intervalMs);
    const curr = sample(dbPath);
    samples += 1;
    const at = now() - started;
    if (curr.main === null) {
      log(`  ${stamp(at)}  main DB disappeared — stopping watch`);
      finalWal = curr.wal;
      finalMain = null;
      break;
    }

    const ev = detectEvent(prev, curr);
    if (ev.walGrew) totalWalDelta += ev.walDelta;
    if (ev.checkpoint) flushEvents.push({ at, fromWal: prev.wal, toWal: curr.wal, mainDelta: ev.mainDelta });
    peakWal = Math.max(peakWal, curr.wal);
    finalWal = curr.wal;
    finalMain = curr.main;

    let line = `  ${stamp(at)}  WAL ${formatBytes(curr.wal)} (${Math.round(curr.wal / pageSize)}p) · main ${formatBytes(curr.main)}`;
    if (ev.checkpoint) {
      line += `  ← flush (WAL ${formatBytes(prev.wal)} → ${formatBytes(curr.wal)}, main ${ev.mainDelta >= 0 ? '+' : ''}${formatBytes(Math.abs(ev.mainDelta))})`;
    }
    log(line);
    prev = curr;
  }

  const elapsed = Math.max(now() - started, 1);
  log('  ── summary ──');
  log(`  samples: ${samples} · window ${stamp(elapsed).slice(2)}`);
  log(`  write activity: WAL +${formatBytes(totalWalDelta)} total (≈ ${formatBytes(totalWalDelta / (elapsed / 60000))}/min) · peak WAL ${formatBytes(peakWal)}`);
  if (flushEvents.length > 0) {
    log(`  flush events: ${flushEvents.length}  ${flushEvents.map((f) => `(t+${stamp(f.at).slice(2)}: WAL ${formatBytes(f.fromWal)} → ${formatBytes(f.toWal)})`).join(' · ')}`);
  } else {
    log('  flush events: none observed in the window');
  }
  log(`  final: WAL ${formatBytes(finalWal)} · main ${finalMain === null ? '—' : formatBytes(finalMain)}`);
  const finalPages = Math.round(finalWal / pageSize);
  if (info.autocheckpointPages && finalPages >= info.autocheckpointPages && flushEvents.length === 0) {
    log(`  note: WAL crossed the ${info.autocheckpointPages}-page auto-checkpoint threshold (${finalPages}p) with no flush — deferred (the app holds an open reader); run verify:conv-db to flush it`);
  }
  log('RESULT: PASS');

  return {
    kind: 'ok',
    samples,
    elapsedMs: elapsed,
    totalWalDelta,
    peakWal,
    flushEvents: flushEvents.length,
    finalWal,
    finalMain,
  };
}

async function watchMain() {
  const flagIdx = process.argv.indexOf('--db');
  const flagValue = flagIdx >= 0 ? process.argv[flagIdx + 1] : undefined;
  const dbPath = resolveDbPath(process.env, flagValue);
  const { intervalMs, durationMs } = parseWatchArgs(process.argv, process.env);

  console.log(`Freebuff conversation DB watch (${dbPath}) — ${Math.round(durationMs / 1000)}s window, ${Math.round(intervalMs / 1000)}s interval (passive — never writes)`);
  const result = await runWatch(dbPath, { intervalMs, durationMs });
  if (result.kind === 'skip') {
    console.log('  — cannot watch — DB file missing (nothing to observe)');
    console.log('RESULT: SKIPPED');
    process.exit(0);
  }
  process.exit(0);
}

function main() {
  // --watch: the passive steady-state observer (never touches the DB).
  if (process.argv.includes('--watch')) {
    watchMain().catch((err) => {
      console.error(`  ✗ FAIL: ${err instanceof Error ? err.message : String(err)}`);
      console.error('RESULT: FAIL');
      process.exit(1);
    });
    return;
  }

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
