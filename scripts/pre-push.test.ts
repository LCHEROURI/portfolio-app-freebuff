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

describe('.githooks/pre-push · onboarding-docs render diff gate (gate 0.6c)', () => {
  it('lists the docs-render gate in the header gate inventory', () => {
    expect(hook).toContain('0.6c scripts/capture-docs.mjs --check');
    expect(hook).toContain('committed onboarding PNGs would change');
  });

  it('defines the gate block that runs capture-docs.mjs --check', () => {
    expect(hook).toContain('# ── 0.6c Onboarding-docs render diff gate');
    expect(hook).toContain('node scripts/capture-docs.mjs --check');
  });

  it('runs capture-docs.mjs --check through the gate\'s OWN exec line, not WRITE mode', () => {
    // Line-anchored: the exec must be a plain line inside the gate's own
    // function (never routed through run_verify's 90s wrapper, never wrapped
    // in an `if ...; then` that would break the retry structure) and MUST
    // carry --check — without it the gate would run capture-docs.mjs in WRITE
    // mode and rewrite the committed PNGs on every push instead of comparing
    // them.
    expect(hook).toMatch(/^\s*perl -e 'alarm shift; exec @ARGV' 90 node scripts\/capture-docs\.mjs --check\s*$/m);
  });

  it('wraps the gate in a named function so it can be retried, mirroring the deployed-hash gate', () => {
    expect(hook).toContain('run_docs_gate() {');
    expect(hook).toMatch(/^\s*if run_docs_gate; then$/m);
  });

  it('retries ONCE after a 30s backoff before failing the push', () => {
    expect(hook).toContain('sleep 30');
    expect(hook).toContain('if run_docs_gate; then');
    expect(hook).toContain('onboarding-docs render diff passed ✓ (on retry)');
    expect(hook).toContain('transient Chrome failure?');
    // The second failure branch must not be followed by a hardcoded exit 1
    // that would swallow the real rc into a bare 1.
    const gateTail = hook.slice(hook.indexOf('onboarding-docs render diff FAILED'));
    expect(gateTail).toMatch(/exit 1\s*$/m);
  });

  it('names the 142 alarm timeout and the re-capture failure reason', () => {
    expect(hook).toContain('exceeded 90s');
    expect(hook).toContain('run npm run capture:docs and commit');
  });

  it('skips with a notice when Chrome is missing, matching gates 3/3b', () => {
    expect(hook).toContain('Chrome not found — skipping onboarding-docs render diff');
  });

  it('sits after the dead-word lint gate (0.6b) and before the vercel-env gate (0.7)', () => {
    const gate06c = hook.indexOf('# ── 0.6c Onboarding-docs render diff gate');
    const gate06b = hook.indexOf('# ── 0.6b Dead-feature lint gate');
    const gate07 = hook.indexOf('# ── 0.7 Vercel-env drift gate');
    expect(gate06c).toBeGreaterThan(gate06b);
    expect(gate06c).toBeGreaterThan(-1);
    expect(gate07).toBeGreaterThan(gate06c);
  });
});

describe('.githooks/pre-push · production sign-in + Firestore sync gate (gate 3)', () => {
  it('lists the sign-in gate in the header gate inventory', () => {
    expect(hook).toContain('3. scripts/verify-prod-signin.mjs');
    expect(hook).toContain('needs FIREBASE_WEB_API_KEY + Chrome');
  });

  it('defines the gate block that runs verify-prod-signin.mjs', () => {
    expect(hook).toContain('# ── 3. Sign-in + Firestore sync gate');
    expect(hook).toContain('node scripts/verify-prod-signin.mjs');
  });

  it('wraps the gate in a named function so it can be retried, mirroring the deployed-hash gate', () => {
    expect(hook).toContain('run_signin_gate() {');
    expect(hook).toMatch(/^\s*if run_signin_gate; then$/m);
  });

  it('retries ONCE after a 30s backoff before failing the push', () => {
    expect(hook).toContain('sleep 30');
    expect(hook).toContain('if run_signin_gate; then');
    expect(hook).toContain('production sign-in + Firestore sync passed ✓ (on retry)');
    expect(hook).toContain('transient live-app failure?');
    // The second failure branch must not be followed by a hardcoded exit 1
    // that would swallow the real rc into a bare 1.
    const gateTail = hook.slice(hook.indexOf('production sign-in + Firestore sync FAILED'));
    expect(gateTail).toMatch(/exit 1\s*$/m);
  });

  it('names the 142 alarm timeout and the fix-before-pushing failure reason', () => {
    expect(hook).toContain('production sign-in + Firestore sync exceeded 90s');
    expect(hook).toContain('fix before pushing');
  });

  it('gates on the web API key AND Chrome, skipping with notices when either is missing', () => {
    expect(hook).toContain('[ -n "$KEY" ] && [ -f scripts/verify-prod-signin.mjs ]');
    expect(hook).toContain('Chrome not found — skipping sign-in proof');
    expect(hook).toContain('FIREBASE_WEB_API_KEY not set — skipping sign-in proof');
  });

  it('sits after the cron-reports gate (2) and before the profile no-email gate (3b)', () => {
    const gate3 = hook.indexOf('# ── 3. Sign-in + Firestore sync gate');
    const gate2 = hook.indexOf('# ── 2. Cron-reports gate');
    const gate3b = hook.indexOf('# ── 3b. Profile no-email gate');
    expect(gate3).toBeGreaterThan(gate2);
    expect(gate3).toBeGreaterThan(-1);
    expect(gate3b).toBeGreaterThan(gate3);
  });
});

describe('.githooks/pre-push · profile no-email walkthrough gate (gate 3b)', () => {
  it('lists the profile no-email gate in the header gate inventory', () => {
    expect(hook).toContain('3b. scripts/verify-profile-no-email.mjs');
    expect(hook).toContain('needs FIREBASE_WEB_API_KEY + Chrome');
  });

  it('defines the gate block that runs verify-profile-no-email.mjs', () => {
    expect(hook).toContain('# ── 3b. Profile no-email gate');
    expect(hook).toContain('node scripts/verify-profile-no-email.mjs');
  });

  it('wraps the gate in a named function so it can be retried, mirroring the deployed-hash gate', () => {
    expect(hook).toContain('run_profile_gate() {');
    expect(hook).toMatch(/^\s*if run_profile_gate; then$/m);
  });

  it('retries ONCE after a 30s backoff before failing the push', () => {
    expect(hook).toContain('sleep 30');
    expect(hook).toContain('if run_profile_gate; then');
    expect(hook).toContain('profile no-email walkthrough passed ✓ (on retry)');
    expect(hook).toContain('transient live-app failure?');
    // The second failure branch must not be followed by a hardcoded exit 1
    // that would swallow the real rc into a bare 1.
    const gateTail = hook.slice(hook.indexOf('profile no-email walkthrough FAILED'));
    expect(gateTail).toMatch(/exit 1\s*$/m);
  });

  it('names the 142 alarm timeout and the fix-before-pushing failure reason', () => {
    expect(hook).toContain('profile no-email walkthrough exceeded 90s');
    expect(hook).toContain('fix before pushing');
  });

  it('gates on the web API key AND Chrome, skipping with notices when either is missing', () => {
    expect(hook).toContain('[ -n "$KEY" ] && [ -f scripts/verify-profile-no-email.mjs ]');
    expect(hook).toContain('Chrome not found — skipping profile no-email proof');
    expect(hook).toContain('FIREBASE_WEB_API_KEY not set — skipping profile no-email proof');
  });

  it('sits after the sign-in gate (3) and before the ship:ready capstone (4)', () => {
    const gate3b = hook.indexOf('# ── 3b. Profile no-email gate');
    const gate3 = hook.indexOf('# ── 3. Sign-in + Firestore sync gate');
    const gate4 = hook.indexOf('# ── 4. ship:ready final capstone gate');
    expect(gate3b).toBeGreaterThan(gate3);
    expect(gate3b).toBeGreaterThan(-1);
    expect(gate4).toBeGreaterThan(gate3b);
  });
});

describe('.githooks/pre-push · review-sheet byte gate (gate 0.6d)', () => {
  it('lists the review-sheet byte gate in the header gate inventory', () => {
    expect(hook).toContain('0.6d scripts/verify-review-sheet.mjs --check');
    expect(hook).toContain('deterministically and FAILS if the committed pair');
  });

  it('defines the gate block that runs verify-review-sheet.mjs --check', () => {
    expect(hook).toContain('# ── 0.6d Review-sheet byte gate');
    expect(hook).toContain('verify-review-sheet.mjs --check --out /tmp/review-sheet-bytecheck');
  });

  it('timeboxes the gate with its OWN budget, not the 90s run_verify timebox', () => {
    // The driver drives the LIVE app with two AI round-trips (up to ~90s
    // each), so running it under run_verify's 90s budget would always alarm
    // out. The gate must use a dedicated perl alarm (same treatment as the
    // 1200s ship:ready capstone), NOT the run_verify function.
    expect(hook).toContain("perl -e 'alarm shift; exec @ARGV' 420 node scripts/verify-review-sheet.mjs --check");
    // Line-anchored: the exec must be a plain line inside the gate's own
    // function (never routed through run_verify's 90s wrapper, never wrapped
    // in an `if ...; then` that would break the retry structure).
    expect(hook).toMatch(/^\s*perl -e 'alarm shift; exec @ARGV' 420 node scripts\/verify-review-sheet\.mjs --check --out \/tmp\/review-sheet-bytecheck\s*$/m);
  });

  it('wraps the gate in a named function so it can be retried, mirroring the deployed-hash gate', () => {
    // The driver drives the LIVE app: transient failures (sign-in network
    // blips, slow AI round-trips, an interception that did not attach on the
    // first run) have been observed. The gate must define a reusable function
    // and invoke it via `if run_review_sheet_gate; then` so the retry branch
    // below can call the SAME wrapped invocation a second time.
    expect(hook).toContain('run_review_sheet_gate() {');
    expect(hook).toMatch(/^\s*if run_review_sheet_gate; then$/m);
  });

  it('retries ONCE after a 30s backoff before failing the push', () => {
    // Mirror of the deployed-hash gate's retry: a transient clears on the
    // retry and the push proceeds; a genuine stale pair fails both attempts
    // and aborts. The retry must sleep before re-invoking the SAME function
    // and must have a distinct on-retry success line.
    expect(hook).toContain('sleep 30');
    expect(hook).toContain('if run_review_sheet_gate; then');
    expect(hook).toContain('review-sheet byte gate passed ✓ (on retry)');
    expect(hook).toContain('transient live-app failure?');
    // The second failure branch must not be followed by a hardcoded exit 1
    // that would swallow the real rc into a bare 1.
    const gateTail = hook.slice(hook.indexOf('review-sheet byte gate FAILED'));
    expect(gateTail).toMatch(/exit 1\s*$/m);
  });

  it('gates on the web API key AND Chrome, skipping with notices when either is missing', () => {
    expect(hook).toContain('[ -n "$KEY" ] && [ -f scripts/verify-review-sheet.mjs ]');
    expect(hook).toContain('Chrome not found — skipping review-sheet byte gate');
    expect(hook).toContain('FIREBASE_WEB_API_KEY not set — skipping review-sheet byte gate');
  });

  it('names the 142 alarm timeout and the re-capture failure reason', () => {
    expect(hook).toContain('exceeded 420s');
    expect(hook).toContain('re-capture and commit the PNGs');
  });

  it('sits after the docs-render gate (0.6c) and before the vercel-env gate (0.7)', () => {
    const gate06d = hook.indexOf('# ── 0.6d Review-sheet byte gate');
    const gate06c = hook.indexOf('# ── 0.6c Onboarding-docs render diff gate');
    const gate07 = hook.indexOf('# ── 0.7 Vercel-env drift gate');
    expect(gate06d).toBeGreaterThan(gate06c);
    expect(gate06d).toBeGreaterThan(-1);
    expect(gate07).toBeGreaterThan(gate06d);
  });
});
