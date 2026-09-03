#!/usr/bin/env node
// ============================================================================
// scripts/ship-go.mjs — one-command release: commit → push → wait for the
// Firebase App Hosting deploy → prove the deployed build with ship:ready.
//
//   npm run ship:go -- "feat(ui): polish the Command Center"
//
// ship:ready (scripts/ship-ready.mjs) answers "are we ready to ship?" but
// only proves LOCAL HEAD is green — it cannot see whether the build App
// Hosting is serving actually carries that commit. ship:go closes the loop:
//
//   1. COMMIT — stages and commits the ENTIRE working tree with the given
//      message (default: "chore(release): ship working tree via ship:go").
//      A dirty tree is exactly what ship:ready blocks on, so ship:go owns
//      the commit: there is no way to reach the clean state ship:ready
//      requires without committing or stashing. Use --dry-run to preview
//      the plan before anything is committed.
//   2. PUSH  — git push origin <branch> (default main). The pre-push hook
//      runs the full local gate suite (timeboxed 90s each) before the commit
//      leaves the machine.
//   3. WAIT  — polls the canonical production URL through
//      verify-deployed-hash.mjs --url ... --expect <sha> (the repo's single
//      source of truth for the deployed-hash lookup) until the
//      deployment serving it carries the pushed commit. Default 6 minutes at
//      15s intervals; --max-wait <sec> and --poll <sec> tune it.
//   4. VERIFY — runs npm run ship:ready (clean-tree check + the full
//      verify:all suite against production). Because step 3 waited for the
//      deploy, the deployed-hash gate inside verify:all now proves 'ready'
//      against what is ACTUALLY live, not just local HEAD.
//
// Exit codes: 0 SHIP READY · 1 a step failed (push, deploy timeout, or
// ship:ready nonzero) · 2 (reserved; the driver no longer exits 2) · 3 unusable (git
// failed). Pure helpers (parseArgs / pollDecision) are exported so the flow
// is unit-tested in scripts/ship-go.test.ts; main() runs only as the entry
// point. Write access: commits the working tree and pushes — deliberate.
// ============================================================================

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { parseTreeStatus } from './ship-ready.mjs';
import { PRODUCTION_URL } from './verify-deployed-hash.mjs';

const REPO_ROOT = resolve(process.cwd());

export const DEFAULT_MESSAGE = 'chore(release): ship working tree via ship:go';

/** Parse CLI flags into a plain object. Message = --message, else the first
 * non-flag token (flags and their values are consumed sequentially, so a
 * positional message after `--branch main` cannot grab the flag's value). */
export function parseArgs(rawArgs) {
  const args = rawArgs.map((a) => a.trim());
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const out = {
    message: null,
    branch: 'main',
    maxWaitSec: 360,
    pollIntervalSec: 15,
    dryRun: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (a === '--message' || a === '--branch' || a === '--max-wait' || a === '--poll') {
      const value = args[i + 1];
      // Only consume the next token as this flag's value when it is not itself
      // a flag — otherwise `--branch --dry-run` would swallow the dry-run flag.
      const consumed = Boolean(value) && !value.startsWith('-');
      if (consumed) i += 1;
      if (a === '--message') out.message = consumed ? value : null;
      else if (a === '--branch') out.branch = consumed ? value : 'main';
      else if (a === '--max-wait') out.maxWaitSec = num(consumed ? value : undefined, 360);
      else if (a === '--poll') out.pollIntervalSec = num(consumed ? value : undefined, 15);
      continue;
    }
    // First remaining non-flag token is the positional message (only used when
    // no explicit --message was given — an explicit --message anywhere wins).
    if (!a.startsWith('-') && out.message === null) out.message = a;
  }
  out.message = out.message ?? DEFAULT_MESSAGE;
  return out;
}

/**
 * Decide what a deploy-poll attempt means. exitCode comes from
 * verify-deployed-hash.mjs: 0 = deployed commit matches · 1 = no match
 * invalid/revoked (no point retrying) · anything else = not yet deployed.
 * @returns {'deployed'|'token-invalid'|'timeout'|'keep-waiting'}
 */
export function pollDecision(exitCode, attempt, maxAttempts) {
  if (exitCode === 0) return 'deployed';
  if (exitCode === 2) return 'token-invalid';
  if (attempt >= maxAttempts) return 'timeout';
  return 'keep-waiting';
}

/**
 * True when verify-deployed-hash.mjs output carries its "no commit sha
 * recorded" skip marker — the --expect path exits 0 even when it skipped the
 * assertion (a CLI/prebuilt deploy without git metadata), so exit 0 alone is
 * NOT proof the deployed commit matched. Treat a skip as still-waiting: a
 * deployment that never records a sha must time out honestly, not end the
 * wait as "deployed".
 */
export function isSkipMarker(output) {
  return /no commit sha recorded|skipping the assertion/.test(String(output ?? ''));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const maxAttempts = Math.max(1, Math.ceil(args.maxWaitSec / args.pollIntervalSec));

  console.log('── ship:go ──────────────────────────────────────────────');
  console.log(`  message   ${args.message}`);
  console.log(`  branch    ${args.branch}`);
  console.log(`  wait      up to ${args.maxWaitSec}s (poll ${args.pollIntervalSec}s)`);

  const git = (cmd) => spawnSync('git', cmd, { cwd: REPO_ROOT, encoding: 'utf8' });

  // ── 1. Commit the working tree ────────────────────────────────────────────
  const status = git(['status', '--porcelain']);
  if (status.error || status.status !== 0) {
    console.error(`  ✗ could not read the working tree: ${(status.stderr || status.error?.message || 'git status failed').toString().trim().slice(0, 300)}`);
    console.error('VERDICT: SHIP BLOCKED — cannot determine the tree state');
    process.exit(3);
  }
  const dirty = parseTreeStatus(status.stdout);

  if (args.dryRun) {
    console.log('\n[1/4] DRY RUN — would commit the working tree:');
    if (dirty.length === 0) {
      console.log('    (tree is already clean — commit skipped)');
    } else {
      for (const line of dirty.slice(0, 12)) console.log(`    ${line}`);
      if (dirty.length > 12) console.log(`    …and ${dirty.length - 12} more`);
    }
    console.log(`[2/4] would push to origin/${args.branch}`);
    console.log(`[3/4] would poll ${PRODUCTION_URL} for the pushed commit (≤${args.maxWaitSec}s)`);
    console.log('[4/4] would run npm run ship:ready against the deployed build');
    console.log('\nVERDICT: DRY RUN — nothing committed, nothing pushed');
    process.exit(0);
  }

  if (dirty.length > 0) {
    console.log(`\n[1/4] Committing the working tree (${dirty.length} file(s))`);
    const add = git(['add', '-A']);
    if (add.error || add.status !== 0) {
      console.error(`  ✗ git add failed: ${(add.stderr || add.error?.message || 'git add failed').toString().trim().slice(0, 300)}`);
      process.exit(1);
    }
    const commit = git(['commit', '-m', args.message]);
    if (commit.error || commit.status !== 0) {
      console.error(`  ✗ git commit failed: ${(commit.stderr || commit.error?.message || 'git commit failed').toString().trim().slice(0, 300)}`);
      process.exit(1);
    }
    console.log(`    ✓ committed as ${git(['rev-parse', '--short', 'HEAD']).stdout.trim()}`);
  } else {
    console.log('\n[1/4] Working tree is already clean — nothing to commit');
  }

  const localSha = git(['rev-parse', 'HEAD']).stdout.trim();

  // ── 2. Push (the pre-push hook runs the full local gate suite) ────────────
  console.log('\n[2/4] Pushing to origin (pre-push hook runs the local gates)…');
  const push = git(['push', 'origin', args.branch]);
  if (push.error || push.status !== 0) {
    const detail = (push.stderr || push.stdout || push.error?.message || 'git push failed').toString().trim();
    console.error(`  ✗ push failed (exit ${push.status ?? '?'}): ${detail.slice(0, 600)}`);
    console.error('VERDICT: SHIP BLOCKED — fix the push (or SKIP_VERIFY_SIGNIN=1 to bypass the pre-push gates), then re-run ship:go');
    process.exit(1);
  }
  console.log(`    ✓ pushed ${localSha.slice(0, 12)} to origin/${args.branch}`);

  // ── 3. Wait for the deploy to carry the pushed commit ─────────────────────
  console.log(`\n[3/4] Waiting for ${PRODUCTION_URL} to serve ${localSha.slice(0, 12)} (≤${args.maxWaitSec}s)…`);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const check = spawnSync('node', ['scripts/verify-deployed-hash.mjs', '--url', PRODUCTION_URL, '--expect', localSha], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: process.env,
    });
    // verify-deployed-hash exits 0 even when its --expect assertion was
    // SKIPPED (no commit sha recorded on the deployment) — exit 0 alone is not
    // proof of a match. A skip output keeps us waiting so a sha-less
    // deployment times out honestly instead of flipping the wait to "deployed".
    const decision = isSkipMarker(check.stdout)
      ? pollDecision(1, attempt, maxAttempts)
      : pollDecision(check.status ?? 1, attempt, maxAttempts);
    if (decision === 'deployed') {
      console.log(`    ✓ deployed commit matches on attempt ${attempt}`);
      break;
    }
    if (decision === 'token-invalid') {
      // Reserved path: the App Hosting driver never exits 2 (it authenticates
      // via gcloud ADC, not a token), so this branch is defensive only.
      console.error('  ✗ could not authenticate to read the App Hosting rollouts — run `gcloud auth login`, then re-run ship:go');
      process.exit(2);
    }
    if (decision === 'timeout') {
      console.error(`  ✗ production did not serve ${localSha.slice(0, 12)} within ${args.maxWaitSec}s — the deploy may have failed or is still building. Run node scripts/verify-deployed-hash.mjs --url ${PRODUCTION_URL} --expect ${localSha} to inspect.`);
      process.exit(1);
    }
    const shown = (check.stdout || '').split('\n').find((l) => l.includes('commit')) ?? '';
    console.log(`    attempt ${attempt}/${maxAttempts}: not yet deployed${shown ? ` (${shown.trim()})` : ''} — waiting ${args.pollIntervalSec}s`);
    await new Promise((r) => setTimeout(r, args.pollIntervalSec * 1000));
  }

  // ── 4. Prove the DEPLOYED build with ship:ready ───────────────────────────
  console.log('\n[4/4] Running ship:ready against the deployed build…');
  const exitCode = await new Promise((resolvePromise) => {
    const child = spawn('npm', ['run', 'ship:ready'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => resolvePromise(code ?? 1));
    child.on('error', (err) => {
      console.error(`  ✗ failed to spawn ship:ready: ${err.message}`);
      resolvePromise(3);
    });
  });
  process.exit(exitCode);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(3);
  });
}
