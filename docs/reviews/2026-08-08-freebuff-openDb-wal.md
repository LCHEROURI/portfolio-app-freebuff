# Finding, Freebuff app conversation DB: no periodic WAL checkpoint, 2026-08-08

**Severity**: Low (data-safe; the WAL is bounded and self-limiting). Tracks a
missing maintenance path in the Freebuff desktop app's own SQLite setup.
**Status**: Open (app-side fix recommended; external one-shot tooling ships in
this repo as an interim)
**Applies to**: Freebuff desktop 0.0.29 (macOS arm64), installed bundle
`/Applications/Freebuff.app`

## The finding

The Freebuff desktop app opens the conversation DB
(`<project>/.freebuff/desktop-v2.db`) in WAL mode but never runs a truncating
checkpoint, and never tunes `wal_autocheckpoint` or `busy_timeout` on that
connection. As a result the `-wal` sidecar grows past the 1000-page
auto-checkpoint threshold and stays there for long stretches: observed at
4.1 MiB (1049 pages) with no flush across a 4-minute passive watch.

## Exact source location (from the installed bundle)

`/Applications/Freebuff.app/Contents/Resources/orchestrator/orchestrator.js`
(the Bun orchestrator; the app's own compiled source — no separate source
checkout is on disk):

```js
// line 132971
var DB_FILENAME = "desktop-v2.db";
// line 132968
import { Database } from "bun:sqlite";
// line 137436 — the single live connection, shared by ThreadsRepo,
// MessagesRepo, QueueRepo, LedgerRepo
const dbPath = `${deps.root}/.freebuff/${DB_FILENAME}`;
const db2 = this.db = openDb(dbPath);
// line 133140
function openDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  upgrade(db);
  return db;
}
```

A pragma scan of the whole bundle confirms: `journal_mode = WAL` and
`foreign_keys = ON` are set, and the only other pragmas are
`PRAGMA user_version = 1` (schema upgrade) and a `busy_timeout = 0` on a
separate throwaway ownership-lock DB — nothing on the conversation connection
for `wal_autocheckpoint`, `wal_checkpoint`, or `busy_timeout`.

## Root cause of the never-flushed WAL (verified Aug 2026)

The app keeps one live `bun:sqlite` connection that performs reads around its
writes. At commit time an open read transaction blocks SQLite's automatic
PASSIVE checkpoint from RESETTING the WAL (`busy=1`): the frames still get
copied into the main DB (why the main DB stays a stable ~48 MiB) but the
`-wal` file is not truncated. During idle gaps (no read transaction open) an
external `PRAGMA wal_checkpoint(TRUNCATE)` succeeds instantly (`busy=0`), and
the passive checkpoint does eventually fire when a commit lands in an idle gap
— observed live: the WAL dropped 4.1 MiB → 1.0 MiB on its own between two
checks. So the WAL is never stuck and never unbounded; it ratchets to
~4–5 MiB of mostly dead space and stays there.

## Recommended app-side fix

- **Do not** raise `wal_autocheckpoint` — the mechanism is the blocked reset,
  not the threshold; raising it only defers the crossing and enlarges the WAL.
- **Do** add an explicit idle-period checkpoint: a timer (e.g. every 60–300 s)
  running `PRAGMA wal_checkpoint(TRUNCATE)` (or
  `sqlite3_wal_checkpoint_v2(..., SQLITE_CHECKPOINT_TRUNCATE, ...)`) when no
  read transaction is open, retrying on busy. The app has one advantage over
  any external agent: it knows when its own reads are done, so it can
  checkpoint cleanly between transactions. Add it in `openDb()` after the
  existing pragmas.
- This is a footprint nicety, not a correctness fix — the data is always safe
  in the WAL and flushes on the next idle gap.

## Interim mitigation shipped in this repo

- `npm run maintain:conv-db` — one-shot TRUNCATE checkpoint when the WAL
  exceeds 2 MiB, with busy-retry (verified PASS, idles when at/below
  threshold).
- `npm run verify:conv-db` / `npm run verify:conv-db:watch` — write-path proof
  and passive steady-state observation.
- A launchd agent (`scripts/conv-db-maintain-schedule.sh install`) schedules
  the one-shot every 10 minutes, but macOS TCC blocks launchd-spawned
  processes from `~/Documents` (where this repo lives), so it is uninstalled
  pending Full Disk Access on the responsible app (Freebuff, `com.freebuff.desktop`)
  plus an app restart.
