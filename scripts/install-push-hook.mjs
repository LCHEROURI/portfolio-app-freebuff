#!/usr/bin/env node
// ============================================================================
// scripts/install-push-hook.mjs — install the pre-push guard into any checkout.
//
// Copies this repo's canonical `.githooks/pre-push` into each target repo and
// points that repo at it with `git config core.hooksPath .githooks`, so every
// project gets the same sign-in / cron-email / authorized-domains guard. The
// hook itself is self-gating: in repos without the verify suite (or without the
// deployment secrets) it skips the unavailable checks instead of failing, so a
// routine push is never blocked by a repo that can't run the suite.
//
// Usage:
//   node scripts/install-push-hook.mjs <repo-path> [more paths...]
//   node scripts/install-push-hook.mjs --all      # every git repo under ~/Documents
//   node scripts/install-push-hook.mjs --dry-run  # show what would change
//
// Idempotent: re-running refreshes the hook file and re-asserts core.hooksPath.
// Exits nonzero if any target failed so CI / a shell chain can gate on it.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const HOOK_SOURCE = resolve(HERE, '..', '.githooks', 'pre-push');
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALL = args.includes('--all');
const targets = args.filter((a) => !a.startsWith('--'));

if (!existsSync(HOOK_SOURCE)) {
  console.error('[install-push-hook] ✗ source hook not found:', HOOK_SOURCE);
  process.exit(1);
}

// ─── Discover git checkouts under a root (depth-limited, node_modules pruned) ─
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

const repos = targets.length
  ? targets.map((t) => resolve(t.replace(/^~/, homedir())))
  : ALL
    ? findGitDirs(resolve(homedir(), 'Documents'), 6)
    : [];

if (repos.length === 0) {
  console.error('[install-push-hook] no repos given. Pass paths or use --all to sweep ~/Documents.');
  process.exit(1);
}

const log = (msg) => console.log(`[install-push-hook] ${msg}`);
const rows = [];
for (const repo of repos) {
  const gitDir = join(repo, '.git');
  if (!existsSync(gitDir)) {
    rows.push({ repo, status: 'SKIP', detail: 'not a git checkout' });
    log(`✗ ${repo} — not a git checkout (no .git)`);
    continue;
  }
  try {
    if (DRY_RUN) {
      rows.push({ repo, status: 'DRY', detail: 'would install hook + set core.hooksPath' });
      log(`· ${repo} — would install (dry run)`);
      continue;
    }
    const hookDir = join(repo, '.githooks');
    mkdirSync(hookDir, { recursive: true });
    const dest = join(hookDir, 'pre-push');
    copyFileSync(HOOK_SOURCE, dest);
    chmodSync(dest, 0o755);
    execFileSync('git', ['-C', repo, 'config', 'core.hooksPath', '.githooks']);
    rows.push({ repo, status: '✓', detail: 'hook installed, core.hooksPath set' });
    log(`✓ ${repo} — installed .githooks/pre-push + core.hooksPath`);
  } catch (err) {
    rows.push({ repo, status: 'ERROR', detail: err.message });
    log(`✗ ${repo} — ${err.message}`);
  }
}

// ─── Summary table ──────────────────────────────────────────────────────────
const nameW = Math.max(4, ...rows.map((r) => r.repo.length));
const pad = (s, w) => String(s).padEnd(w).slice(0, w);
console.log('\n' + [
  `  ${pad('REPO', nameW)}  STATUS  DETAIL`,
  `  ${'-'.repeat(nameW)}  ------  ------`,
].join('\n'));
for (const r of rows) {
  console.log(`  ${pad(r.repo, nameW)}  ${pad(r.status, 6)}  ${r.detail}`);
}
const ok = rows.filter((r) => r.status === '✓' || r.status === 'DRY').length;
const bad = rows.length - ok;
console.log(`\n[install-push-hook] ${ok}/${rows.length} repos ready${bad ? `, ${bad} failed` : ''}.`);
if (bad > 0) process.exit(1);
