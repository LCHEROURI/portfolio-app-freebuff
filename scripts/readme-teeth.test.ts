import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/readme-teeth.test.ts — lock the README "Re-proving the gate's
// teeth in seconds" section.
//
// Same discipline as the cook repo's readme-teeth.test.ts: read the REAL
// README from disk and assert the teeth-proof one-liners — and the verdict
// strings they document — survive future edits. The section is the
// maintenance manual for re-verifying the deployed-hash gate's FAIL /
// STALE-HEAD BLOCK / hook BLOCK paths; if an edit drops a one-liner, removes
// the --stale-guard flag from it, or softens an expected verdict, a
// maintainer can no longer re-prove the gate in seconds.
//
// Scope discipline: all assertions are scoped to the teeth section (header →
// next `### ` heading), so prose elsewhere can never satisfy a verdict.
// ============================================================================

const README = readFileSync('README.md', 'utf8');

const teethStart = README.indexOf("### Re-proving the gate's teeth in seconds");
const teethEnd = README.indexOf('\n### ', teethStart + 1);
const TEETH = README.slice(teethStart, teethEnd === -1 ? undefined : teethEnd);

describe("README · 'Re-proving the gate's teeth in seconds'", () => {
  it('keeps the section with its read-only framing and the npm-script entry points', () => {
    expect(TEETH.length).toBeGreaterThan(0);
    expect(TEETH).toContain('All are read-only against git and Vercel');
    // The npm scripts are the no-copy-paste entry points; the runner copies
    // the CURRENT artifacts, so the proofs are age-independent.
    expect(TEETH).toContain('copies the CURRENT hook/driver artifacts in');
    expect(TEETH).toContain('independent of the worktree');
    expect(TEETH).toContain('npm run verify:teeth-proofs');
    expect(TEETH).toContain('ALL three teeth in one command');
    expect(TEETH).toContain('npm run verify:gate-stale-proof');
    expect(TEETH).toContain('npm run verify:hook-block-proof');
    expect(TEETH).toContain('expects RESULT: FAIL');
    expect(TEETH).toContain('expects ✗ STALE-HEAD BLOCK');
    expect(TEETH).toContain('expects ✗ BLOCKED');
  });

  it('keeps the Gate FAIL one-liner (plain gate invocation) with its expected verdict', () => {
    // The gate in plain mode composes the driver with --expect <worktree
    // HEAD>; the mismatch prints RESULT: FAIL and exits 1. The invocation is
    // the gate SCRIPT directly — the repo's `npm run verify:deployed-hash`
    // targets the raw driver (report mode), which never prints RESULT: FAIL.
    expect(TEETH).toContain('git worktree add --detach /tmp/portfolio-hash-proof HEAD~1');
    expect(TEETH).toContain('(cd /tmp/portfolio-hash-proof && node scripts/verify-deployed-hash-gate.mjs');
    expect(TEETH).toContain('echo "gate exit=$?"');
    expect(TEETH).toContain('git worktree remove /tmp/portfolio-hash-proof --force');
    expect(TEETH).toContain('`RESULT: FAIL` and `gate exit=1`');
  });

  it('keeps the CI stale-guard one-liner WITH the --stale-guard flag and its STALE-HEAD BLOCK verdict', () => {
    expect(TEETH).toContain('git worktree add --detach /tmp/portfolio-stale-guard HEAD~1');
    expect(TEETH).toContain('(cd /tmp/portfolio-stale-guard && node scripts/verify-deployed-hash-gate.mjs --stale-guard');
    expect(TEETH).toContain('git worktree remove /tmp/portfolio-stale-guard --force');
    expect(TEETH).toContain('`✗ STALE-HEAD BLOCK` and `gate exit=1`');
  });

  it('keeps the Hook BLOCK one-liner (current hook AND driver copied in, main-push stdin) with its BLOCKED verdict', () => {
    // The portfolio hook delegates gate 0 to the gate driver, so the BLOCK
    // proof must copy the CURRENT driver (and the base driver it composes)
    // into the worktree alongside the hook — making the proof independent of
    // the worktree commit's age, exactly like the cook repo's one-liner.
    expect(TEETH).toContain('git worktree add --detach /tmp/portfolio-hook-block HEAD~1');
    expect(TEETH).toContain("mkdir -p /tmp/portfolio-hook-block/.githooks && cp .githooks/pre-push /tmp/portfolio-hook-block/.githooks/");
    expect(TEETH).toContain("cp scripts/verify-deployed-hash-gate.mjs scripts/verify-deployed-hash.mjs /tmp/portfolio-hook-block/scripts/");
    expect(TEETH).toContain("printf 'refs/heads/main a refs/heads/main b\\n' | bash .githooks/pre-push");
    expect(TEETH).toContain('echo "hook exit=$?"');
    expect(TEETH).toContain('git worktree remove /tmp/portfolio-hook-block --force');
    expect(TEETH).toContain('`✗ BLOCKED` and `hook exit=1`');
  });
});
