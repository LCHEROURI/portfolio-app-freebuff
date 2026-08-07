import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/pre-push.test.ts — lock the ship:ready capstone gate contract.
//
// Reads the REAL .githooks/pre-push hook from disk (never a fixture): the
// whole point is that a future edit which drops, reorders, or weakens gate 4
// fails here instead of silently letting a push leave the machine without the
// one-command go-live verdict. A missing hook file THROWS loudly rather than
// passing vacuously — a repo without the hook has nothing to lock.
//
// The assertions target distinctive substrings (not the full comment lines)
// so they stay robust to surrounding prose edits while still pinning the
// load-bearing parts: the gate's existence, its 1200s budget (vs the 90s
// per-verifier timebox), its exit-code branches (142 timeout, 2 dirty tree,
// generic failure), the FORWARDED exit code (exit $ship_rc, so the push's
// status carries ship:ready's own 1/2/3/142 verdict instead of a bare 1),
// the SKIP_VERIFY_SIGNIN early-exit that bypasses the capstone, the
// missing-file skip, and its position as the FINAL gate before the success
// line.
// ============================================================================

const HOOK_PATH = '.githooks/pre-push';
const hook = readFileSync(HOOK_PATH, 'utf8');

describe('.githooks/pre-push · ship:ready capstone gate (gate 4)', () => {
  it('defines gate 4 as the ship:ready final capstone', () => {
    expect(hook).toContain('4. ship:ready final capstone gate');
    expect(hook).toContain('runs the FULL verify:all suite');
  });

  it('lists gate 4 in the header gate inventory', () => {
    expect(hook).toContain('#   4. scripts/ship-ready.mjs');
  });

  it('runs ship-ready.mjs under the 1200s budget, not the 90s per-verifier timebox', () => {
    expect(hook).toContain("perl -e 'alarm shift; exec @ARGV' 1200 node scripts/ship-ready.mjs");
  });

  it('captures the exit code so each branch can name its reason', () => {
    expect(hook).toContain('ship_rc=$?');
  });

  it('names the 142 alarm timeout as too-slow-run-CI', () => {
    expect(hook).toContain('ship_rc" -eq 142');
    expect(hook).toContain('exceeded 1200s');
    expect(hook).toContain('too slow, run CI instead');
  });

  it('names the exit-2 dirty tree as commit-or-stash', () => {
    expect(hook).toContain('ship_rc" -eq 2');
    expect(hook).toContain('working tree is dirty');
    expect(hook).toContain('commit or stash before pushing');
  });

  it('keeps the SKIP_VERIFY_SIGNIN escape hatch on every failure branch', () => {
    const failures = hook.match(/SKIP_VERIFY_SIGNIN=1 to override/g) ?? [];
    // The 142, dirty-tree, and generic-failure branches each carry it.
    expect(failures.length).toBeGreaterThanOrEqual(3);
  });

  it('skips with a notice when ship-ready.mjs is missing', () => {
    expect(hook).toContain('[ -f scripts/ship-ready.mjs ]');
    expect(hook).toContain('skipping ship:ready capstone');
  });

  it('FORWARDS ship:ready\'s exit code instead of collapsing it to a bare 1', () => {
    // Line-anchored on purpose: the generic-failure ECHO also prints
    // `(exit $ship_rc)`, so a bare toContain would pass vacuously even if the
    // actual `exit $ship_rc` statement were deleted. Only a whole-line match
    // proves the real forwarding line exists.
    expect(hook).toMatch(/^\s*exit \$ship_rc\s*$/m);
    // And the generic-failure branch must not be followed by a hardcoded
    // exit 1 that would swallow the forwarded code.
    const gate4Tail = hook.slice(hook.indexOf('ship:ready FAILED'));
    expect(gate4Tail).not.toMatch(/ship:ready FAILED[\s\S]*?exit 1\s*\n/);
  });

  it('SKIP_VERIFY_SIGNIN=1 at the top bypasses the capstone entirely', () => {
    // The early-exit guard must sit before gate 4 and exit 0 (allow the push)
    // without ever reaching the ship-ready.mjs invocation. Scoped to the
    // guard BLOCK itself (the `if` through its closing `fi`), not the whole
    // span to gate 4: other gates contain their own `exit 0` (e.g. the
    // not-pushing-to-main path), so a span-wide assertion would pass even if
    // the guard's own `exit 0` were removed.
    const skipGuard = hook.indexOf('if [ "${SKIP_VERIFY_SIGNIN:-0}" = "1" ]; then');
    // The closing `fi` must be its OWN line: indexOf('fi', …) would match the
    // 'fi' inside the echo's word 'verification' and truncate the block
    // before `exit 0`. Search for the newline-delimited closing line instead.
    const guardEnd = hook.indexOf('\nfi\n', skipGuard);
    const guardBlock = hook.slice(skipGuard, guardEnd);
    const gate4 = hook.indexOf('# ── 4. ship:ready final capstone gate');
    expect(skipGuard).toBeGreaterThan(-1);
    expect(guardEnd).toBeGreaterThan(skipGuard);
    expect(guardBlock).toContain('exit 0');
    expect(guardBlock).not.toContain('ship-ready.mjs');
    // The guard must close BEFORE gate 4 exists, so a push under
    // SKIP_VERIFY_SIGNIN=1 can never reach the capstone.
    expect(gate4).toBeGreaterThan(guardEnd);
  });

  it('sits as the FINAL gate, after 3b and before the success line', () => {
    const gate4 = hook.indexOf('# ── 4. ship:ready final capstone gate');
    const gate3b = hook.indexOf('# ── 3b. Profile no-email gate');
    const success = hook.indexOf('pre-push: all applicable checks passed');
    expect(gate4).toBeGreaterThan(gate3b);
    expect(gate4).toBeGreaterThan(-1);
    expect(success).toBeGreaterThan(gate4);
  });
});
