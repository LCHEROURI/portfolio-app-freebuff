#!/usr/bin/env node
// ============================================================================
// scripts/ship-ready.mjs — one-command go-live verdict.
//
// Answers "are we ready to ship?" with a single command:
//
//   npm run ship:ready
//
// 1. Asserts the git working tree is clean (nothing staged, unstaged, or
//    untracked) — a dirty tree means the pushed/deployed commit cannot match
//    the code you just ran, so the verdict would be meaningless.
// 2. Runs the FULL verify:all suite against production (all fifteen §4 gates,
//    including the deployed-hash check that the live build serves local HEAD).
// 3. Prints one verdict line: SHIP READY or SHIP BLOCKED, and exits
//    nonzero when blocked.
//
// Pure helpers (parseTreeStatus / shipVerdict) are exported so the tree-clean
// and verdict logic is unit-tested in scripts/ship-ready.test.ts; main() runs
// only when this file is the entry point. Read-only against the working tree
// except for spawning the verifier child.
// ============================================================================

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(process.cwd());

/**
 * Parse `git status --porcelain` output into the dirty-file list.
 * A truly clean tree yields an empty array (whitespace lines ignored).
 */
export function parseTreeStatus(porcelain) {
  return String(porcelain ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Decide the ship verdict from the two gates this script owns.
 * @param {string[]} dirty  dirty-file list from parseTreeStatus (empty = clean)
 * @param {number|null} verifyExit  exit code of the verify:all child, or null if it never ran
 * @returns {{ ready: boolean, reason: string, exitCode: number }}
 */
export function shipVerdict(dirty, verifyExit) {
  if (dirty.length > 0) {
    return {
      ready: false,
      reason: `working tree is dirty (${dirty.length} file(s)) — commit or stash first`,
      exitCode: 2,
    };
  }
  if (verifyExit === null) {
    return {
      ready: false,
      reason: 'verify:all did not run (spawn failure)',
      exitCode: 3,
    };
  }
  if (verifyExit !== 0) {
    return {
      ready: false,
      reason: `verify:all failed with exit code ${verifyExit}`,
      exitCode: 1,
    };
  }
  return {
    ready: true,
    reason: 'tree is clean and every verify:all gate is green against production',
    exitCode: 0,
  };
}

async function main() {
  // ── 1. Tree-clean check ───────────────────────────────────────────────────
  console.log('── ship:ready ──────────────────────────────────────────────');
  console.log('[1/2] Checking the working tree is clean');
  // spawnSync does NOT throw when git is missing or the cwd is not a repo — it
  // returns { error, status: 128, stdout: '' }. Validate the result BEFORE
  // trusting stdout, or a broken git would silently read as a clean tree and
  // the pre-check would be meaningless.
  const gitRes = spawnSync('git', ['status', '--porcelain'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (gitRes.error || gitRes.status !== 0) {
    console.error(`    ✗ could not determine the working-tree state: ${(gitRes.stderr || gitRes.error?.message || 'git status failed').toString().trim().slice(0, 300)}`);
    console.error('\nVERDICT: SHIP BLOCKED — cannot verify the tree is clean');
    process.exit(3);
  }
  const dirty = parseTreeStatus(gitRes.stdout);
  if (dirty.length > 0) {
    console.error('    ✗ working tree is dirty:');
    for (const line of dirty.slice(0, 12)) {
      console.error(`      ${line}`);
    }
    if (dirty.length > 12) console.error(`      …and ${dirty.length - 12} more`);
    const v = shipVerdict(dirty, null);
    console.error(`\nVERDICT: SHIP BLOCKED — ${v.reason}`);
    process.exit(v.exitCode);
  }
  console.log('    ✓ clean — nothing staged, unstaged, or untracked');

  // ── 2. Full verify:all suite against production ──────────────────────────
  console.log('\n[2/2] Running the full verify:all suite against production');
  const exitCode = await new Promise((resolvePromise) => {
    const child = spawn('npm', ['run', 'verify:all'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => resolvePromise(code ?? 1));
    child.on('error', (err) => {
      console.error(`    ✗ failed to spawn verify:all: ${err.message}`);
      // Resolve with null (NOT 3) so shipVerdict's spawn-failure branch fires
      // with the accurate "did not run" message instead of a bogus "exit code 3".
      resolvePromise(null);
    });
  });

  // ── 3. Verdict ────────────────────────────────────────────────────────────
  const v = shipVerdict([], exitCode);
  console.log('\n══════════════════════════════════════════════════════════');
  if (v.ready) {
    console.log('  SHIP READY — ' + v.reason);
  } else {
    console.error('  SHIP BLOCKED — ' + v.reason);
  }
  console.log('══════════════════════════════════════════════════════════');
  process.exit(v.exitCode);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(3);
  });
}
