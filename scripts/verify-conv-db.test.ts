import { execFileSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DB_PATH,
  convDbVerdict,
  detectEvent,
  formatBytes,
  parseCheckpoint,
  parseIntegrity,
  parseJournal,
  parseWatchArgs,
  resolveDbPath,
  runProof,
  runWatch,
  walBytes,
} from './verify-conv-db.mjs';

// ============================================================================
// scripts/verify-conv-db.test.ts — lock the conversation-DB write-proof
// gate's pure helpers and exit decisions. runProof takes the sqlite runner as
// an injectable argument (default: the macOS sqlite3 CLI), so every step of
// the write cycle — integrity, scratch write, checkpoint, cleanup — is
// lockable with fake runners and no built-in mocking, mirroring
// verify-disk-headroom's probeUsePct.
// ============================================================================

describe('parseIntegrity · the scalar pragma reader', () => {
  it('reads a clean integrity result', () => {
    expect(parseIntegrity('ok')).toBe('ok');
    expect(parseIntegrity('ok\n')).toBe('ok');
  });

  it('trims multi-line integrity errors to their joined text', () => {
    const out = 'page 42 is malformed\npage 43 is malformed\n';
    expect(parseIntegrity(out)).toBe('page 42 is malformed\npage 43 is malformed');
  });
});

describe('parseJournal · journal-mode reader', () => {
  it('reads wal and delete modes', () => {
    expect(parseJournal('wal\n')).toBe('wal');
    expect(parseJournal('delete')).toBe('delete');
  });
});

describe('parseCheckpoint · the busy|log|checkpointed row', () => {
  it('parses a full flush row', () => {
    expect(parseCheckpoint('0|544|544')).toEqual({ busy: 0, log: 544, checkpointed: 544 });
  });

  it('parses an already-empty WAL row', () => {
    expect(parseCheckpoint('0|0|0')).toEqual({ busy: 0, log: 0, checkpointed: 0 });
  });

  it('parses a busy row (app holds a read lock)', () => {
    expect(parseCheckpoint('1|12|0')).toEqual({ busy: 1, log: 12, checkpointed: 0 });
  });

  it('sentinel non-numeric cells so a malformed row can never read as a clean flush', () => {
    expect(parseCheckpoint('garbage')).toEqual({ busy: -1, log: -1, checkpointed: -1 });
  });
});

describe('formatBytes · human-readable sizes', () => {
  it('formats bytes through GiB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(4096)).toBe('4.0 KiB');
    expect(formatBytes(5242880)).toBe('5.0 MiB');
    expect(formatBytes(1073741824)).toBe('1.0 GiB');
  });
});

describe('parseWatchArgs · watch-mode flags and env', () => {
  it('defaults to a 15s interval and a 3m window', () => {
    expect(parseWatchArgs([], {})).toEqual({ intervalSec: 15, durationSec: 180, intervalMs: 15000, durationMs: 180000 });
  });

  it('honors --interval and --duration flags', () => {
    expect(parseWatchArgs(['--interval', '5', '--duration', '60'], {})).toEqual({
      intervalSec: 5,
      durationSec: 60,
      intervalMs: 5000,
      durationMs: 60000,
    });
  });

  it('honors CONV_DB_WATCH_INTERVAL / CONV_DB_WATCH_DURATION env overrides', () => {
    expect(parseWatchArgs([], { CONV_DB_WATCH_INTERVAL: '10', CONV_DB_WATCH_DURATION: '120' })).toEqual({
      intervalSec: 10,
      durationSec: 120,
      intervalMs: 10000,
      durationMs: 120000,
    });
  });

  it('lets flags win over env', () => {
    expect(parseWatchArgs(['--interval', '5'], { CONV_DB_WATCH_INTERVAL: '10' }).intervalSec).toBe(5);
  });

  it('falls back to defaults on invalid values (zero, negative, non-numeric)', () => {
    for (const bad of ['0', '-5', 'abc']) {
      expect(parseWatchArgs(['--interval', bad], {}).intervalSec).toBe(15);
      expect(parseWatchArgs(['--duration', bad], {}).durationSec).toBe(180);
    }
  });
});

describe('detectEvent · per-sample delta classification', () => {
  it('flags WAL growth as write activity', () => {
    expect(detectEvent({ wal: 100, main: 10 }, { wal: 4096, main: 10 })).toMatchObject({
      walDelta: 3996,
      walGrew: true,
      walShrank: false,
      checkpoint: false,
    });
  });

  it('flags a WAL shrink as a flush event and tracks the main-DB delta', () => {
    expect(detectEvent({ wal: 4096, main: 10 }, { wal: 0, main: 4106 })).toMatchObject({
      walDelta: -4096,
      walShrank: true,
      checkpoint: true,
      mainDelta: 4096,
    });
  });

  it('classifies a flat window as idle', () => {
    expect(detectEvent({ wal: 100, main: 10 }, { wal: 100, main: 10 })).toMatchObject({
      walDelta: 0,
      walGrew: false,
      walShrank: false,
      checkpoint: false,
    });
  });
});

describe('resolveDbPath · path resolution', () => {
  it('defaults to the Freebuff conversation DB path', () => {
    expect(resolveDbPath({})).toBe(DEFAULT_DB_PATH);
    expect(DEFAULT_DB_PATH).toBe('.freebuff/desktop-v2.db');
  });

  it('honors the CONV_DB_PATH env override', () => {
    expect(resolveDbPath({ CONV_DB_PATH: '/tmp/other.db' })).toBe('/tmp/other.db');
  });

  it('lets the --db flag win over the env var', () => {
    expect(resolveDbPath({ CONV_DB_PATH: '/env.db' }, '/flag.db')).toBe('/flag.db');
  });
});

describe('walBytes · the -wal sidecar size', () => {
  it('returns 0 when the sidecar is absent (an empty WAL is 0 bytes)', () => {
    expect(walBytes('/nonexistent/db', () => {
      throw new Error('ENOENT');
    })).toBe(0);
  });

  it('returns the sidecar size when present', () => {
    expect(walBytes('/tmp/db', () => ({ size: 4096 }))).toBe(4096);
  });
});

// ── convDbVerdict: the pure exit decision ────────────────────────────────────
describe('convDbVerdict · skip / fail / warn / pass contract', () => {
  it('skips (exit 0, never fails) when sqlite3 is unavailable', () => {
    expect(convDbVerdict({ sqliteAvailable: false })).toEqual({ kind: 'skip' });
  });

  it('skips (exit 0) when the DB file does not exist — nothing to prove', () => {
    expect(convDbVerdict({ dbExists: false })).toEqual({ kind: 'skip' });
  });

  it('fails on an integrity error before the write cycle', () => {
    expect(convDbVerdict({ integrityBefore: 'page 7 is malformed' })).toEqual({
      kind: 'fail',
      reason: 'integrity before = "page 7 is malformed"',
    });
  });

  it('fails on an integrity error after the write cycle', () => {
    expect(convDbVerdict({ integrityAfter: 'page 9 is malformed' })).toEqual({
      kind: 'fail',
      reason: 'integrity after = "page 9 is malformed"',
    });
  });

  it('fails when the committed scratch row did not survive (rows != 1)', () => {
    expect(convDbVerdict({ rows: 0 })).toEqual({
      kind: 'fail',
      reason: 'scratch write not readable back (rows=0, expected 1)',
    });
  });

  it('fails when the WAL is not truncated after a clean checkpoint', () => {
    expect(convDbVerdict({ walBytesAfter: 8192, checkpoint: { busy: 0, log: 2, checkpointed: 2 } })).toEqual({
      kind: 'fail',
      reason: 'WAL not truncated after checkpoint (8192 bytes remain)',
    });
  });

  it('warns (still pass) when a busy checkpoint left WAL frames — the app is writing', () => {
    const verdict = convDbVerdict({ walBytesAfter: 4096, checkpoint: { busy: 1, log: 1, checkpointed: 0 } });
    expect(verdict.kind).toBe('warn');
    expect(verdict.reason).toContain('checkpoint busy');
  });

  it('passes with a clean WAL-mode flush (truncated to 0 bytes)', () => {
    expect(convDbVerdict({ journalMode: 'wal', walBytesAfter: 0, checkpoint: { busy: 0, log: 0, checkpointed: 0 } })).toEqual({
      kind: 'pass',
      journalMode: 'wal',
      checkpoint: { busy: 0, log: 0, checkpointed: 0 },
      walBytesAfter: 0,
      walAsserted: true,
    });
  });

  it('passes in a non-WAL journal (commit path proven; truncation not asserted)', () => {
    const verdict = convDbVerdict({ journalMode: 'delete', walBytesAfter: 0 });
    expect(verdict.kind).toBe('pass');
    expect(verdict.walAsserted).toBe(false);
  });
});

// ── runProof: the orchestrated cycle, exercised against a REAL temp DB ───────
const sqliteAvailable = (() => {
  try {
    execFileSync('sqlite3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('runProof · skip path (injected runner)', () => {
  it('skips-not-fails when the sqlite runner throws ENOENT (binary missing)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-'));
    const db = join(dir, 'x.db');
    try {
      writeFileSync(db, ''); // existsSync must pass; only the runner is broken
      const verdict = runProof(db, () => {
        throw Object.assign(new Error('sqlite3: command not found'), { code: 'ENOENT' });
      });
      expect(verdict).toEqual({ kind: 'skip' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!sqliteAvailable)('runProof · real temp-DB integration', () => {
  it('passes the full WAL write cycle on a real sqlite DB and leaves zero trace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-'));
    const db = join(dir, 'test.db');
    try {
      // A brand-new sqlite3 DB starts in delete journal mode; flip it to WAL so
      // the truncate assertion actually applies (the app uses WAL).
      execFileSync('sqlite3', [db, 'PRAGMA journal_mode=wal;'], { stdio: 'ignore' });

      const verdict = runProof(db);
      expect(verdict.kind).toBe('pass');
      if (verdict.kind === 'pass') expect(verdict.walAsserted).toBe(true);

      // Zero trace: the scratch table is gone and integrity still holds.
      const tables = execFileSync('sqlite3', [db, "SELECT name FROM sqlite_master WHERE name='_disk_proof';"], { encoding: 'utf8' });
      expect(tables.trim()).toBe('');
      expect(execFileSync('sqlite3', [db, 'PRAGMA integrity_check;'], { encoding: 'utf8' }).trim()).toBe('ok');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes on a delete-journal DB (WAL truncation not asserted)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-'));
    const db = join(dir, 'test.db');
    try {
      execFileSync('sqlite3', [db, 'CREATE TABLE t(i);'], { stdio: 'ignore' });
      const verdict = runProof(db);
      expect(verdict.kind).toBe('pass');
      if (verdict.kind === 'pass') expect(verdict.walAsserted).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails loudly when integrity is already broken before the cycle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-'));
    const db = join(dir, 'broken.db');
    try {
      execFileSync('sqlite3', [db, 'CREATE TABLE t(i);'], { stdio: 'ignore' });
      // Corrupt the first header byte ("SQLite format 3\0" → NUL) so sqlite
      // reports "file is not a database" on the very first integrity check.
      const fd = openSync(db, 'r+');
      writeSync(fd, Buffer.from([0x00]), 0, 1, 0);
      closeSync(fd);

      const verdict = runProof(db);
      expect(verdict.kind).toBe('fail');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── runWatch: the passive steady-state observer (injected timers + sample) ───
describe('runWatch · the steady-state observer', () => {
  // Drive the observer deterministically: a real temp file satisfies the
  // existsSync gate while the injected sample script, fake clock and sync
  // sleep control every sample without touching real timers.
  const makeWatch = (seq, { intervalMs = 15000, durationMs = 30000 } = {}) => {
    const logs = [];
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-watch-'));
    const db = join(dir, 'x.db');
    writeFileSync(db, '');
    let t = 0;
    let i = 0;
    const run = runWatch(db, {
      intervalMs,
      durationMs,
      now: () => t,
      sleep: async () => {
        t += intervalMs;
      },
      sample: () => seq[Math.min(i++, seq.length - 1)],
      pragmas: () => ({ journalMode: 'wal', pageSize: 4096, autocheckpointPages: 1000 }),
      log: (line) => logs.push(line),
    });
    return { run, logs, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  };

  it('samples on the interval and reports write growth + a flush event', async () => {
    const { run, logs, cleanup } = makeWatch([
      { wal: 0, main: 100 },
      { wal: 4096, main: 100 }, // grew: write activity
      { wal: 0, main: 4196 }, // shrank: flush frames into main
    ]);
    try {
      const result = await run;
      expect(result).toMatchObject({ kind: 'ok', samples: 3, totalWalDelta: 4096, flushEvents: 1, finalWal: 0, finalMain: 4196 });
      const joined = logs.join('\n');
      expect(joined).toContain('WAL 4.0 KiB (1p)');
      expect(joined).toContain('← flush (WAL 4.0 KiB → 0 B, main +4.0 KiB)');
      expect(joined).toContain('RESULT: PASS');
    } finally {
      cleanup();
    }
  });

  it('notes a WAL that crosses the auto-checkpoint threshold with no flush', async () => {
    // Flat at 1280 pages (5 MiB / 4 KiB) — past the 1000-page threshold, no flush.
    const { run, logs, cleanup } = makeWatch([
      { wal: 5242880, main: 100 },
      { wal: 5242880, main: 100 },
      { wal: 5242880, main: 100 },
    ]);
    try {
      const result = await run;
      expect(result).toMatchObject({ kind: 'ok', flushEvents: 0, totalWalDelta: 0 });
      expect(logs.join('\n')).toContain('crossed the 1000-page auto-checkpoint threshold (1280p) with no flush');
    } finally {
      cleanup();
    }
  });

  it('notes a main DB that disappears mid-watch and stops cleanly', async () => {
    const { run, logs, cleanup } = makeWatch([
      { wal: 0, main: 100 },
      { wal: 2048, main: null }, // the main file vanishes mid-watch
      { wal: 0, main: 100 },
    ]);
    try {
      const result = await run;
      expect(result.kind).toBe('ok');
      expect(logs.join('\n')).toContain('main DB disappeared — stopping watch');
      expect(logs.join('\n')).toContain('final: WAL 2.0 KiB · main —');
    } finally {
      cleanup();
    }
  });

  it('renders the file-size-only baseline when sqlite3 is unavailable', async () => {
    const logs = [];
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-watch-'));
    const db = join(dir, 'x.db');
    writeFileSync(db, '');
    try {
      await runWatch(db, {
        intervalMs: 15000,
        durationMs: 0, // no interval waits — just the t=0 sample
        sample: () => ({ wal: 0, main: 0 }),
        pragmas: () => ({}), // sqlite3 unavailable
        sleep: async () => {},
        now: () => 0,
        log: (line) => logs.push(line),
      });
      expect(logs.join('\n')).toContain('sqlite3 unavailable — file-size sampling only');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips-not-fails when the DB is absent', async () => {
    await expect(runWatch(join(tmpdir(), 'no-such-conv-db', 'x.db'))).resolves.toEqual({ kind: 'skip' });
  });
});
