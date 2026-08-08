import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Shared sqlite/path/size helpers (parseCheckpoint, walBytes, resolveDbPath,
// formatBytes) live in verify-conv-db.mjs and are covered by its test — this
// file tests only what maintain-conv-db.mjs itself defines, plus the
// integration tests that measure the -wal sidecar directly.
import { walBytes } from './verify-conv-db.mjs';

import {
  DEFAULT_DB_PATH,
  maintainVerdict,
  parseMaintainArgs,
  runMaintenance,
} from './maintain-conv-db.mjs';

// ============================================================================
// scripts/maintain-conv-db.test.ts — lock the periodic WAL-maintenance
// script's pure helpers and outcome contract. runMaintenance takes the sqlite
// runner / stat / sleep as injectable arguments (default: the real sqlite3
// CLI + fs + timers), so every branch — skip / idle / truncated / busy-retry /
// error — is lockable with fake runners and no built-in mocking, mirroring
// verify-conv-db's runProof.
// ============================================================================

describe('parseMaintainArgs · flags and env', () => {
  it('defaults to the conversation DB, 4 MiB threshold, 3 retries, 2s backoff', () => {
    expect(parseMaintainArgs([], {})).toEqual({
      dbPath: DEFAULT_DB_PATH,
      threshold: 4 * 1024 * 1024,
      retries: 3,
      retryDelayMs: 2000,
    });
  });

  it('honors flags', () => {
    expect(parseMaintainArgs(['--db', '/tmp/x.db', '--threshold', '8388608', '--retries', '5', '--retry-delay', '3000'], {})).toEqual({
      dbPath: '/tmp/x.db',
      threshold: 8388608,
      retries: 5,
      retryDelayMs: 3000,
    });
  });

  it('honors env overrides', () => {
    expect(parseMaintainArgs([], {
      CONV_DB_PATH: '/env.db',
      CONV_DB_MAINTAIN_THRESHOLD: '1048576',
      CONV_DB_MAINTAIN_RETRIES: '7',
      CONV_DB_MAINTAIN_RETRY_DELAY: '5000',
    })).toEqual({ dbPath: '/env.db', threshold: 1048576, retries: 7, retryDelayMs: 5000 });
  });

  it('lets flags win over env', () => {
    expect(parseMaintainArgs(['--threshold', '4096'], { CONV_DB_MAINTAIN_THRESHOLD: '1048576' }).threshold).toBe(4096);
  });

  it('falls back to defaults on invalid values (zero, negative, non-numeric)', () => {
    for (const bad of ['0', '-5', 'abc']) {
      expect(parseMaintainArgs(['--threshold', bad], {}).threshold).toBe(4 * 1024 * 1024);
      expect(parseMaintainArgs(['--retries', bad], {}).retries).toBe(3);
    }
  });
});

describe('maintainVerdict · the pure skip/idle decision', () => {
  it('skips when sqlite3 is unavailable', () => {
    expect(maintainVerdict({ sqliteAvailable: false })).toEqual({ kind: 'skip' });
  });

  it('skips when the DB file is absent — nothing to maintain', () => {
    expect(maintainVerdict({ dbExists: false })).toEqual({ kind: 'skip' });
  });

  it('is idle at or below the threshold', () => {
    expect(maintainVerdict({ walBefore: 4 * 1024 * 1024, threshold: 4 * 1024 * 1024 })).toEqual({
      kind: 'idle',
      walBefore: 4 * 1024 * 1024,
      threshold: 4 * 1024 * 1024,
    });
  });

  it('is idle below the threshold', () => {
    expect(maintainVerdict({ walBefore: 1024, threshold: 4 * 1024 * 1024 }).kind).toBe('idle');
  });

  it('returns null (run the checkpoint loop) above the threshold', () => {
    expect(maintainVerdict({ walBefore: 5 * 1024 * 1024, threshold: 4 * 1024 * 1024 })).toBeNull();
  });
});

describe('runMaintenance · the checkpoint loop (injected runner)', () => {
  it('skips-not-fails when the sqlite runner throws ENOENT (binary missing)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-maint-'));
    const db = join(dir, 'x.db');
    try {
      writeFileSync(db, ''); // existsSync must pass; only the runner is broken
      // The probe runs only when the WAL is above the threshold — report a
      // large sidecar so the ENOENT path is actually exercised.
      const result = await runMaintenance(db, {
        runSqliteImpl: () => {
          throw Object.assign(new Error('sqlite3: command not found'), { code: 'ENOENT' });
        },
        statImpl: (p) => ({ size: p.endsWith('-wal') ? 5 * 1024 * 1024 : 0 }),
      });
      expect(result).toEqual({ kind: 'skip' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails loudly on a non-ENOENT probe error (broken DB, never a silent pass)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-maint-'));
    const db = join(dir, 'x.db');
    try {
      writeFileSync(db, 'not a database');
      const result = await runMaintenance(db, {
        runSqliteImpl: () => {
          throw Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });
        },
        statImpl: (p) => ({ size: p.endsWith('-wal') ? 5 * 1024 * 1024 : 0 }),
      });
      expect(result.kind).toBe('error');
      if (result.kind === 'error') expect(result.reason).toContain('not a database');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats an unreadable checkpoint result (busy sentinel) as an error, never a busy deferral', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-maint-'));
    const db = join(dir, 'x.db');
    try {
      writeFileSync(db, '');
      let call = 0;
      const result = await runMaintenance(db, {
        runSqliteImpl: () => {
          call += 1;
          return call === 1 ? 'ok' : 'garbage'; // malformed TRUNCATE output
        },
        statImpl: (p) => ({ size: p.endsWith('-wal') ? 5 * 1024 * 1024 : 0 }),
        sleep: async () => {},
      });
      expect(result.kind).toBe('error');
      if (result.kind === 'error') expect(result.reason).toContain('unreadable checkpoint result');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idle when the WAL is at or below the threshold', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-maint-'));
    const db = join(dir, 'x.db');
    try {
      writeFileSync(db, '');
      const result = await runMaintenance(db, {
        statImpl: (p) => ({ size: p.endsWith('-wal') ? 1024 : 0 }),
      });
      expect(result.kind).toBe('idle');
      if (result.kind === 'idle') expect(result.walBefore).toBe(1024);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('truncates on the first attempt when the checkpoint is clean', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-maint-'));
    const db = join(dir, 'x.db');
    try {
      writeFileSync(db, '');
      let walNow = 5 * 1024 * 1024;
      const result = await runMaintenance(db, {
        runSqliteImpl: () => '0|281|281',
        statImpl: (p) => {
          if (!p.endsWith('-wal')) return { size: 0 };
          const size = walNow;
          walNow = 0; // TRUNCATE succeeded → WAL now empty
          return { size };
        },
      });
      expect(result).toMatchObject({ kind: 'truncated', walBefore: 5 * 1024 * 1024, walAfter: 0, attempts: 1 });
      if (result.kind === 'truncated') expect(result.checkpoint.busy).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('retries past a busy checkpoint and truncates on the second attempt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-maint-'));
    const db = join(dir, 'x.db');
    try {
      writeFileSync(db, '');
      // Call 1 is the availability probe; TRUNCATE attempts start at call 2.
      let call = 0;
      let walNow = 5 * 1024 * 1024;
      const result = await runMaintenance(db, {
        retries: 3,
        retryDelayMs: 1,
        runSqliteImpl: () => {
          call += 1;
          if (call === 1) return 'ok';
          return call === 2 ? '1|5|0' : '0|0|0'; // first TRUNCATE busy (app read txn), then clean
        },
        statImpl: (p) => {
          if (!p.endsWith('-wal')) return { size: 0 };
          const size = walNow;
          if (call >= 3) walNow = 0;
          return { size };
        },
        sleep: async () => {},
      });
      expect(result).toMatchObject({ kind: 'truncated', attempts: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports busy (pass, deferred) when every attempt is blocked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-maint-'));
    const db = join(dir, 'x.db');
    try {
      writeFileSync(db, '');
      const result = await runMaintenance(db, {
        retries: 2,
        runSqliteImpl: () => '1|5|0',
        statImpl: (p) => ({ size: p.endsWith('-wal') ? 5 * 1024 * 1024 : 0 }),
        sleep: async () => {},
      });
      expect(result).toMatchObject({ kind: 'busy', attempts: 2, walBefore: 5 * 1024 * 1024 });
      if (result.kind === 'busy') expect(result.checkpoint.busy).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips-not-fails when the DB is absent', async () => {
    await expect(runMaintenance(join(tmpdir(), 'no-such-conv-db', 'x.db'))).resolves.toEqual({ kind: 'skip' });
  });
});

// ── Real temp-DB integration (skip-not-fail without sqlite3) ────────────────
const sqliteAvailable = (() => {
  try {
    execFileSync('sqlite3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!sqliteAvailable)('runMaintenance · real temp-DB integration', () => {
  it('truncates a WAL grown past the threshold on a real sqlite DB', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-maint-'));
    const db = join(dir, 'test.db');
    // Hold a real connection open with auto-checkpoint disabled — the app's
    // observed behavior (its read txn blocks the automatic reset, so the WAL
    // keeps its frames). A CLI one-shot would auto-truncate on exit, so spawn
    // an interactive sqlite3 whose stdin stays open (the process holds the DB).
    const proc = spawn('sqlite3', [db], { stdio: ['pipe', 'ignore', 'ignore'] });
    try {
      proc.stdin.write(
        'PRAGMA journal_mode=wal;\n'
        + 'PRAGMA wal_autocheckpoint=0;\n'
        + 'CREATE TABLE t(x);\n'
        + 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<700) INSERT INTO t SELECT randomblob(8000) FROM c;\n',
      );
      // Wait (bounded) for the insert to commit and the WAL to grow past the
      // threshold — a fixed sleep could race a slow CI runner.
      let before = 0;
      const deadline = Date.now() + 5000;
      while (before <= 4 * 1024 * 1024 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        before = walBytes(db);
      }
      expect(before).toBeGreaterThan(4 * 1024 * 1024);

      const result = await runMaintenance(db, { threshold: 4 * 1024 * 1024, retries: 2 });
      expect(result.kind).toBe('truncated');
      if (result.kind === 'truncated') {
        expect(result.walAfter).toBeLessThan(before);
        // The data survived the truncate — the table still holds all 700 rows.
        const count = execFileSync('sqlite3', [db, 'SELECT count(*) FROM t;'], { encoding: 'utf8' }).trim();
        expect(count).toBe('700');
        expect(execFileSync('sqlite3', [db, 'PRAGMA integrity_check;'], { encoding: 'utf8' }).trim()).toBe('ok');
      }
    } finally {
      proc.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idle on a DB whose WAL is under the threshold', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-db-maint-'));
    const db = join(dir, 'test.db');
    try {
      execFileSync('sqlite3', [db, 'PRAGMA journal_mode=wal; CREATE TABLE t(x); INSERT INTO t VALUES (1);'], { stdio: 'ignore' });
      const result = await runMaintenance(db, { threshold: 4 * 1024 * 1024 });
      expect(result.kind).toBe('idle');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
