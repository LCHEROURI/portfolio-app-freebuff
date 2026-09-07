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
//                                             # the daily report via the cron
//                                             # endpoint (CRON_SECRET required)
//                                             # and verify its AI sections
//   node scripts/scan-all.mjs --notify-secret <s>  # explicit cron secret
//
// Exits nonzero if any repo failed to ingest, so it can gate CI or be chained.
//
// --notify AI retry-once (same tolerance as scripts/verify-cron-reports.mjs):
// the regenerated daily report's AI sections come from OpenRouter, and a
// transient provider blip can ship a body without them even though the app is
// healthy (the 8182177 flake passed minutes later, same host/script/secret,
// all six AI sections rendered). So when the deployed app reports AI
// configured (configured.openrouter=true) and the daily body fails the AI
// sub-checks on the FIRST pass, wait AI_RETRY_DELAY_MS and re-fetch the report
// once, re-running the AI sub-checks. A blip clears on retry (notify logs a
// pass instead of a failure); a real regression fails BOTH passes (still
// loud). Deterministic checks (ok flag, counts) never retry.
// ============================================================================

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalEnv } from './local-env.mjs';

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
    return readLocalEnv('CRON_SECRET');
  } catch {
    return undefined;
  }
};

/**
 * Derive the cron endpoint from the scanner API base, so --api points at one
 * origin and the notify call follows it (localhost dev vs deployed prod).
 *
 * ?previewBody=1 is the dev-only flag that makes the response carry each
 * report's composed body — required so the AI sub-checks can inspect the
 * regenerated daily body. It does not change what the route composes or
 * persists (reports are composed in-app; the route only logs activity).
 */
const cronUrl = () => {
  const base = API.replace(/\/api\/scanner\/?$/, '');
  return `${base}/api/cron/reports?kind=daily&previewBody=1`;
};

// ── Transient-OpenRouter retry for the --notify daily AI body ───────────────
// Mirrors scripts/verify-cron-reports.mjs (same constants and one-retry-only
// shape): the daily AI sections (executive summary + top-three narration) are
// the only provider-dependent surface in the notify path, so a first-pass
// sub-check failure triggers ONE retry after a short delay before any failure
// is logged. A blip clears on retry; a build that genuinely lost its AI
// sections fails both passes. Deterministic checks (ok flag, counts) never go
// through this path.
const AI_RETRY_DELAY_MS = 5000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The AI sub-checks for a daily report body. The executive summary must always
// carry the friendly heading + raw-id footer. The top-three narration is
// data-dependent (absent when there's no actionable top three), so it is only
// checked when present — matching verify-cron-reports' graceful path. Returns
// [] when all applicable checks pass.
const dailyAiFailures = (report, body) => {
  const fails = [];
  if (!body.includes('## ✨ AI executive summary (DeepSeek Chat)'))
    fails.push('daily body missing friendly exec-summary heading "(DeepSeek Chat)"');
  if (!body.includes('Model: `deepseek/deepseek-chat`'))
    fails.push('daily body missing raw-id footer "Model: `deepseek/deepseek-chat`"');
  const narration = report?.narration;
  if (narration) {
    if (!body.includes('## 🎯 Why these three matter today (DeepSeek Chat)'))
      fails.push('daily body missing narration heading "(DeepSeek Chat)"');
    if (narration.model !== 'deepseek/deepseek-chat')
      fails.push('daily narration.model mismatch');
  }
  return fails;
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
      // AI body verification with retry-once: a provider blip must not turn a
      // good scan into a loud failure — same tolerance as verify-cron-reports.
      // Unconfigured builds (configured.openrouter=false) skip: deterministic-
      // only is the design there, so there is nothing AI to assert.
      const aiConfigured = json.configured?.openrouter === true;
      const dailyReport = json.reports?.find((r) => r.kind === 'daily');
      if (aiConfigured && dailyReport) {
        const dailyBody = dailyReport.body ?? '';
        let fails = dailyAiFailures(dailyReport, dailyBody);
        if (fails.length > 0) {
          log(`--notify: daily AI sub-checks failed on the first pass — retrying once after ${AI_RETRY_DELAY_MS}ms (transient provider blip?)`);
          await sleep(AI_RETRY_DELAY_MS);
          const retryRes = await fetch(url, {
            headers: { authorization: `Bearer ${secret}` },
            cache: 'no-store',
          });
          const retryJson = retryRes.ok ? await retryRes.json().catch(() => null) : null;
          const retryReport = retryJson?.reports?.find((r) => r.kind === 'daily');
          const retryBody = retryReport?.body ?? '';
          const retryFails = dailyAiFailures(retryReport ?? {}, retryBody);
          if (retryFails.length === 0) {
            log('✓ daily AI sub-checks passed on retry — first-pass absence was a transient provider failure, not a regression');
          } else {
            for (const f of retryFails) fail(`--notify: ${f}`);
          }
        } else if (dailyBody.includes('## ✨ AI executive summary (DeepSeek Chat)')) {
          log('✓ daily AI exec summary + narration sub-checks pass on the first pass');
        }
      } else if (aiConfigured) {
        fail('--notify: deployed app reports AI configured but the daily response has no report entry');
      } else if (json.configured?.openrouter === false) {
        log('--notify: deployed app reports NO OPENROUTER_API_KEY — AI body sub-checks SKIP (deterministic checks still enforced)');
      } else {
        log('--notify: deployed build predates the configured.openrouter field — AI body sub-checks re-verify after the next deploy');
      }
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
