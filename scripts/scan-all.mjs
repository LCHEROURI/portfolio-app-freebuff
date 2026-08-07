#!/usr/bin/env node
// ============================================================================
// scripts/scan-all.mjs — sweep every local git repo and ingest it in one shot.
//
// Finds all `.git` folders under a root (default ~/Documents), runs the
// existing repo-scanner companion against each, and prints a summary table so
// every repo's local facts (branch, unpushed commits, uncommitted changes)
// land in data/scans.json — and therefore in the dashboards and daily email —
// with a single command.
//
// Usage:
//   npm run scan:all                          # root ~/Documents, local API
//   node scripts/scan-all.mjs --root ~/dev    # custom root
//   node scripts/scan-all.mjs --api https://portfolio-app-freebuff.vercel.app/api/scanner
//   node scripts/scan-all.mjs --max-depth 4   # limit how deep to descend
//   node scripts/scan-all.mjs --skip foo,bar  # skip repo names
//   node scripts/scan-all.mjs --token <pat>   # bearer token for the API
//   node scripts/scan-all.mjs --notify        # after a clean sweep, regenerate
//                                             # the daily email via the cron
//                                             # endpoint (CRON_SECRET required)
//   node scripts/scan-all.mjs --notify-secret <s>  # explicit cron secret
//
// Exits nonzero if any repo failed to ingest, so it can gate CI or be chained.
// ============================================================================

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const ROOT = resolve(getArg('root', join(homedir(), 'Documents')).replace(/^~/, homedir()));
const API = getArg('api', 'http://localhost:3000/api/scanner');
const MAX_DEPTH = Number(getArg('max-depth', '6'));
const TOKEN = getArg('token', undefined);
const NOTIFY = args.includes('--notify');
const NOTIFY_SECRET = getArg('notify-secret', undefined);
const SKIP = new Set((getArg('skip', '') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const SCANNER = fileURLToPath(new URL('./repo-scanner.mjs', import.meta.url));

const log = (msg) => console.log(`[scan-all] ${msg}`);
const fail = (msg) => console.error(`[scan-all] ✗ ${msg}`);

// ─── Discover .git folders (depth-limited, node_modules pruned) ─────────────
const findGitDirs = (root, maxDepth) => {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable (permissions) — skip
    }
    for (const e of entries) {
      if (e.name === 'node_modules') continue;
      const full = join(dir, e.name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (e.name === '.git') {
        // .git can be a directory (normal repo) or a file (worktree/submodule).
        found.push(dir);
        continue;
      }
      if (st.isDirectory()) walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return found;
};

// ─── One-line scanner summary (repoName, branch, ahead/behind, flags) ───────
const runScanner = (repoPath) => {
  const scannerArgs = ['--path', repoPath, '--api', API];
  if (TOKEN) scannerArgs.push('--token', TOKEN);
  const res = spawnSync(process.execPath, [SCANNER, ...scannerArgs], {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const stdout = res.stdout ?? '';
  const stderr = res.stderr ?? '';

  const branch = stdout.match(/branch: (.+)/)?.[1] ?? '—';
  const remote = stdout.match(/remote: (?:\(none\)|(https?:\/\/[^\s]+|git@[^\s]+))/)?.[1] ?? '';
  const ahead = stdout.match(/(\d+) ahead/)?.[1] ?? '0';
  const behind = stdout.match(/ahead \/ (\d+) behind/)?.[1] ?? '0';
  const uncommitted = stdout.includes('uncommitted changes present');
  const unpushed = Number(ahead) > 0;
  const accepted = stdout.match(/✓ Accepted — repository id (\S+)/)?.[1];
  const error = !accepted
    ? (stderr.match(/\[scanner\] ✗ (.+)/)?.[1] ?? (res.status !== 0 ? `exit ${res.status}` : 'no id'))
    : undefined;

  const name = remote
    ? remote.split(/[\/:]/).slice(-2).join('/').replace(/\.git$/, '')
    : repoPath.split('/').pop() ?? repoPath;

  return {
    name, branch, ahead, behind, uncommitted, unpushed,
    status: error ? 'ERROR' : '✓',
    error: error ?? accepted,
    path: repoPath,
  };
};

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(ROOT)) {
    fail(`root does not exist: ${ROOT}`);
    process.exit(1);
  }

  log(`Scanning ${ROOT} for git repos (max depth ${MAX_DEPTH})…`);
  const dirs = findGitDirs(ROOT, MAX_DEPTH).filter((d) => {
    const name = d.split('/').pop() ?? '';
    if (SKIP.has(name)) {
      log(`skipping ${name} (--skip)`);
      return false;
    }
    return true;
  });

  if (dirs.length === 0) {
    log('No git repos found under the root.');
    process.exit(0);
  }

  log(`Found ${dirs.length} git repo(s). Ingesting to ${API} …\n`);

  const rows = [];
  for (const dir of dirs) {
    try {
      const row = runScanner(dir);
      rows.push(row);
      const flag = `${row.uncommitted ? '✎' : '·'}${row.unpushed ? '⇧' : '·'}`;
      if (row.status === '✓') {
        log(`✓ ${row.name} — ${row.branch}, ${row.ahead} ahead / ${row.behind} behind [${flag}] (${row.error})`);
      } else {
        fail(`${row.name} — ${row.error}`);
      }
    } catch (err) {
      rows.push({ name: dir.split('/').pop(), branch: '—', ahead: '0', behind: '0', uncommitted: false, unpushed: false, status: 'ERROR', error: err.message, path: dir });
      fail(`${dir} — ${err.message}`);
    }
  }

  // ─── Summary table ────────────────────────────────────────────────────────
  const nameW = Math.max(8, ...rows.map((r) => r.name.length));
  const branchW = Math.max(6, ...rows.map((r) => r.branch.length));
  const pad = (s, w) => String(s).padEnd(w).slice(0, w);
  console.log('\n' + [
    `  ${pad('REPO', nameW)}  ${pad('BRANCH', branchW)}  AHEAD  BEHIND  UNCOMMITTED  UNPUSHED  STATUS  ID`,
    `  ${'-'.repeat(nameW)}  ${'-'.repeat(branchW)}  -----  ------  -----------  --------  ------  --`,
  ].join('\n'));
  for (const r of rows) {
    console.log(
      `  ${pad(r.name, nameW)}  ${pad(r.branch, branchW)}  ${pad(r.ahead, 5)}  ${pad(r.behind, 6)}  ${pad(r.uncommitted ? 'yes' : 'no', 11)}  ${pad(r.unpushed ? 'yes' : 'no', 8)}  ${pad(r.status, 6)}  ${r.error ?? '—'}`,
    );
  }

  const ok = rows.filter((r) => r.status === '✓').length;
  const bad = rows.length - ok;
  console.log(`\n[scan-all] ${ok}/${rows.length} repos ingested${bad ? `, ${bad} failed` : ''}.`);
  if (bad > 0) {
    fail('One or more repos failed to ingest.');
    process.exit(1);
  }

  // ─── --notify: regenerate the daily email with fresh local facts ─────────
  if (NOTIFY) {
    await notifyDaily();
  }
}

/**
 * Resolve the CRON_SECRET from --notify-secret, then env, then .env.local,
 * mirroring scripts/verify-cron-reports.mjs so the two never drift.
 */
const resolveCronSecret = () => {
  if (NOTIFY_SECRET) return NOTIFY_SECRET;
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const m = env.match(/^CRON_SECRET=(.*)$/m);
    return m ? m[1].trim().replace(/^"|"$/g, '') : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Derive the cron endpoint from the scanner API base, so --api points at one
 * origin and the notify call follows it (localhost dev vs deployed prod).
 */
const cronUrl = () => {
  const base = API.replace(/\/api\/scanner\/?$/, '');
  return `${base}/api/cron/reports?kind=daily`;
};

/**
 * Fire the daily cron report after a clean sweep so the morning email picks up
 * the freshly scanned facts immediately instead of waiting for the scheduled
 * run. Failures are loud but never exit nonzero: the sweep itself succeeded,
 * and a transient network blip shouldn't turn a good scan into a red run.
 */
const notifyDaily = async () => {
  const secret = resolveCronSecret();
  if (!secret) {
    log('--notify requested but no CRON_SECRET found (set env, pass --notify-secret, or add .env.local) — skipping notify.');
    return;
  }
  const url = cronUrl();
  log(`--notify: regenerating daily report at ${url}…`);
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${secret}` },
      cache: 'no-store',
    });
    if (res.status === 401) {
      fail(`--notify: cron endpoint rejected the secret (401) — CRON_SECRET drift between .env.local and Vercel?`);
      return;
    }
    if (!res.ok) {
      fail(`--notify: cron endpoint returned HTTP ${res.status}`);
      return;
    }
    const json = await res.json().catch(() => null);
    if (json?.ok) {
      const counts = json.counts
        ? ` (${json.counts.projects} projects, ${json.counts.tasks} tasks, ${json.counts.repositories} repos, ${json.counts.deployments} deployments)`
        : '';
      log(`✓ daily report regenerated${counts}${json.note ? ` — ${json.note}` : ''}.`);
    } else {
      fail(`--notify: cron endpoint reported ok=false${json?.note ? ` — ${json.note}` : ''}`);
    }
  } catch (err) {
    fail(`--notify: could not reach cron endpoint — ${err.message}`);
  }
};

main().catch((err) => {
  fail(err.message);
  process.exit(1);
});
