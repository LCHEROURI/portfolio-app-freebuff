import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/pre-push.test.ts — lock the pre-push hook's gate contracts.
//
// Reads the REAL .githooks/pre-push hook from disk (never a fixture): the
// whole point is that a future edit which drops, reorders, or weakens a gate
// fails here instead of silently letting a push leave the machine without the
// one-command go-live verdict. A missing hook file THROWS loudly rather than
// passing vacuously — a repo without the hook has nothing to lock.
//
// The retry-once-after-30s pattern lives ONCE in the shared `run_with_retry`
// helper (mirroring the deployed-hash gate's retry), and every Chrome /
// live-app gate (0.6c docs-render, 0.6d review-sheet, 3 sign-in, 3b
// profile-walkthrough) routes through it with its own budget, failure
// message, and transient descriptor. The assertions pin: the helper's
// structure (timebox primitive, 142-timeout abort, FATAL_RC no-retry path,
// 30s retry, on-retry success line, second-failure exit), each gate's call
// site (budget + label + command with the load-bearing flags), the 1200s
// ship:ready capstone with its FORWARDED exit code (exit $ship_rc, so the
// push's status carries 1/2/3/142 instead of a bare 1) and its deliberate
// exclusion from run_with_retry, the SKIP_VERIFY_SIGNIN early-exit that
// bypasses the capstone, the missing-file skips, and gate ordering.
// ============================================================================

const HOOK_PATH = '.githooks/pre-push';
const hook = readFileSync(HOOK_PATH, 'utf8');

describe('.githooks/pre-push · shared verifier runners', () => {
  it('defines timebox as the single perl-alarm budget primitive', () => {
    expect(hook).toMatch(/^\s*timebox\(\) \{\s*$/m);
    expect(hook).toMatch(/^\s*perl -e 'alarm shift; exec @ARGV' "\$@"\s*$/m);
  });

  it('runs the plain run_verify through timebox with the fixed 90s budget', () => {
    expect(hook).toMatch(/^\s*if timebox 90 node "\$script" "\$@"; then$/m);
  });

  it('defines run_with_retry taking budget/label/fail-msg/transient then the command', () => {
    expect(hook).toMatch(/^\s*run_with_retry\(\) \{\s*$/m);
    expect(hook).toContain('local budget="$1" label="$2" fail_msg="$3" transient="$4"');
    expect(hook).toContain('shift 4');
  });

  it('runs the retried command through timebox with the per-gate budget', () => {
    expect(hook).toMatch(/^\s*if timebox "\$budget" "\$@"; then$/m);
  });

  it('captures rc INSIDE the else, not after a no-else if (else a false condition reads rc=0)', () => {
    // Live proof caught this: `if cmd; then return; fi; local rc=$?` always
    // sees rc=0 because the if statement itself exits 0 on a false condition,
    // which would silently break the 142-timeout and FATAL_RC branches below.
    // The capture must sit inside the else branch (the pre-refactor idiom),
    // and the comment documenting WHY must be present so the reason survives.
    const helper = hook.slice(hook.indexOf('run_with_retry() {'), hook.indexOf('KEY="$(read_env'));
    expect(helper).toContain('# CRITICAL: capture $? INSIDE the else');
    // The capture line itself: `local rc=$?` nested under the else (the
    // comment lines may sit between them, so allow [\s\S]* between).
    expect(helper).toMatch(/else[\s\S]*?local rc=\$\?/);
    // And the buggy no-else shape must NOT exist: a bare
    // `if timebox; then ...; return 0; fi` immediately followed by the capture
    // would read rc=0 on a false condition.
    expect(helper).not.toMatch(/if timebox "\$budget" "\$@"; then\n\s+echo "pre-push: \$label passed ✓"\n\s+return 0\n\s+fi\n\s+local rc=\$\?/);
  });

  it('aborts immediately on the 142 alarm timeout (never retries a budget blowout)', () => {
    expect(hook).toMatch(/\$label exceeded \$\{budget\}s — too slow, run CI instead/);
    expect(hook).toMatch(/\$rc" -eq 142/);
    expect(hook).toContain('SKIP_VERIFY_SIGNIN=1 to override');
  });

  it('honors a FATAL_RC (no retry — the revoked-token contract)', () => {
    expect(hook).toContain('if [ -n "${FATAL_RC:-}" ] && [ "$rc" -eq "$FATAL_RC" ]; then');
  });

  it('retries ONCE after a 30s backoff and re-invokes the SAME command', () => {
    expect(hook).toContain('sleep 30');
    expect(hook).toMatch(/waiting 30s and retrying once \(transient \$transient\?\)/);
    expect(hook).toContain('passed ✓ (on retry)');
  });

  it('prints the per-gate failure message on the second failure and exits 1', () => {
    expect(hook).toMatch(/\$label FAILED — \$fail_msg/);
    const helperTail = hook.slice(hook.indexOf('run_with_retry() {'));
    expect(helperTail).toMatch(/exit 1\s*$/m);
  });
});

describe('.githooks/pre-push · deployed-hash stale-guard gate (gate 0)', () => {
  it('lists the deployed-hash gate in the header gate inventory', () => {
    expect(hook).toContain('0. scripts/verify-deployed-hash-gate.mjs --stale-guard');
    expect(hook).toContain('direction-aware rollback guard');
  });

  it('delegates the ENTIRE verdict to the gate driver --stale-guard (line-anchored exec)', () => {
    // The unification contract: the hook runs the SAME implementation CI
    // runs — a line-anchored exec catches a re-introduced second invocation
    // or a silently dropped --stale-guard flag. The invocation is wrapped in
    // the shared timebox (90s budget) and routed by exit code below.
    expect(hook).toMatch(/^\s*if timebox 90 node scripts\/verify-deployed-hash-gate\.mjs --stale-guard; then\s*$/m);
  });

  it('contains NO reimplemented ancestry logic (merge-base / is-ancestor)', () => {
    // The whole point of the unification: the hook carries ZERO verdict
    // logic — the driver decides. If bash ancestry code ever sneaks back in,
    // the hook and the driver have drifted and this fails (the same negative
    // lock the cook repo's hook test carries).
    expect(hook).not.toMatch(/merge-base/);
    expect(hook).not.toMatch(/is-ancestor/);
  });

  it('routes the driver exit codes: 0 = pass, 2 = warn + continue, else = BLOCKED abort', () => {
    // Exit routing is the hook's ONLY remaining job besides scoping. 2 is a
    // reserved defensive branch (the App Hosting driver authenticates via
    // gcloud ADC and never exits 2) and must NOT abort — while a stale head
    // (exit 1) must abort with the BLOCKED message.
    expect(hook).toContain('could not authenticate to read the App Hosting rollouts');
    expect(hook).toContain('✗ BLOCKED — live is not an ancestor of your local HEAD');
    expect(hook).toContain('SKIP_VERIFY_DEPLOYED_HASH=1');
    // The BLOCKED branch must actually abort (exit 1), and the exit-2 branch
    // must NOT (it falls through to the next gate).
    const blocked = hook.indexOf('✗ BLOCKED');
    expect(blocked).toBeGreaterThan(-1);
    const afterBlocked = hook.slice(blocked, blocked + 400);
    expect(afterBlocked).toContain('exit 1');
  });

  it('keeps the SKIP_VERIFY_DEPLOYED_HASH escape hatch as a skip, not a failure', () => {
    expect(hook).toContain('SKIP_VERIFY_DEPLOYED_HASH=1 — skipping deployed-hash stale-guard');
  });

  it('keeps the first-push skip (all-zeros remote tip has nothing to verify)', () => {
    expect(hook).toContain('first push to main (no previous remote commit)');
  });

  it('sits before the import-surface lint gate (0.6) in the run order', () => {
    const gate0 = hook.indexOf('# ── 0. Deployed-hash stale-guard gate');
    const gate06 = hook.indexOf('# ── 0.6 Import-surface lint gate');
    expect(gate0).toBeGreaterThan(-1);
    expect(gate06).toBeGreaterThan(gate0);
  });

  it('never references the removed Vercel gates (token-health 0.5, vercel-env 0.7)', () => {
    expect(hook).not.toContain('token-health');
    expect(hook).not.toContain('vercel-env');
    expect(hook).not.toContain('VERCEL_TOKEN');
  });
});

describe('.githooks/pre-push · disk headroom gate (gate 0.05)', () => {
  it('lists the disk-headroom gate FIRST in the header gate inventory', () => {
    // Scoped to the header region: the gate block comment ALSO says 'over 90%
    // full', so a whole-hook toContain would pass even if the inventory line
    // were dropped. Only asserting inside the header proves the line lives.
    const header = hook.slice(0, hook.indexOf('# ── 0.05 Disk headroom gate'));
    expect(header).toContain('0.05 scripts/verify-disk-headroom.mjs');
    expect(header).toContain('over 90% full');
    expect(header).toContain('checked FIRST');
  });

  it('defines the gate block that routes the SHARED node script through run_verify', () => {
    // The hook no longer owns a bespoke bash implementation: it runs the SAME
    // scripts/verify-disk-headroom.mjs that verify:all and docs/launch.md §4
    // execute, so the hook and the runner can never drift. Line-anchored on
    // the run_verify call — the load-bearing line.
    expect(hook).toContain('# ── 0.05 Disk headroom gate');
    expect(hook).toMatch(/^\s*run_verify "disk headroom" scripts\/verify-disk-headroom\.mjs\s*$/m);
  });

  it('keeps the single-implementation rationale (shared with verify:all, no bash drift)', () => {
    expect(hook).toContain('the SAME node gate verify:all and');
    expect(hook).toContain('share one implementation');
  });

  it('skips with a notice when the verify script is missing', () => {
    // The skip branch must be an echo-and-continue (never a failure): a repo
    // without the verify suite proceeds, matching every other gate.
    const gateBlock = hook.slice(
      hook.indexOf('# ── 0.05 Disk headroom gate'),
      hook.indexOf('# ── 0. Deployed-hash stale-guard gate'),
    );
    expect(gateBlock).toContain('skipping disk headroom check');
    expect(gateBlock).toContain('[ -f scripts/verify-disk-headroom.mjs ]');
  });

  it('runs BEFORE the deployed-hash gate (0) so a full disk aborts fast', () => {
    const gate005 = hook.indexOf('# ── 0.05 Disk headroom gate');
    const gate0 = hook.indexOf('# ── 0. Deployed-hash stale-guard gate');
    expect(gate005).toBeGreaterThan(-1);
    expect(gate0).toBeGreaterThan(gate005);
  });
});

describe('.githooks/pre-push · ship:ready capstone gate (gate 4)', () => {
  it('defines gate 4 as the ship:ready final capstone', () => {
    expect(hook).toContain('4. ship:ready final capstone gate');
    expect(hook).toContain('runs the FULL verify:all suite');
  });

  it('lists gate 4 in the header gate inventory', () => {
    expect(hook).toContain('#   4. scripts/ship-ready.mjs');
  });

  it('runs ship-ready.mjs under the 1200s budget via timebox, NOT run_with_retry', () => {
    // Line-anchored on purpose: the capstone deliberately bypasses the retry
    // helper (its failures are never transient) but must still go through the
    // shared timebox for the 1200s budget.
    expect(hook).toMatch(/^\s*if timebox 1200 node scripts\/ship-ready\.mjs; then$/m);
    const gate4Tail = hook.slice(hook.indexOf('# ── 4. ship:ready final capstone gate'));
    expect(gate4Tail).toContain('Deliberately NOT run_with_retry');
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

  it('defines the gate block that routes capture-docs.mjs --check through run_with_retry', () => {
    expect(hook).toContain('# ── 0.6c Onboarding-docs render diff gate');
    expect(hook).toContain('run_with_retry 90 "onboarding-docs render diff"');
  });

  it('carries the re-capture guidance as the second-failure message', () => {
    expect(hook).toContain('"run npm run capture:docs and commit"');
  });

  it('keeps --check on the exec line so the gate COMPARES instead of writing', () => {
    // Line-anchored on purpose: the forward must be the real exec line, not a
    // comment mention. Without it, the gate would run capture-docs.mjs in
    // WRITE mode and rewrite the committed PNGs on every push instead of
    // comparing them.
    expect(hook).toMatch(/^\s*node scripts\/capture-docs\.mjs --check\s*$/m);
  });

  it('skips with a notice when Chrome is missing, matching gates 3/3b', () => {
    expect(hook).toContain('Chrome not found — skipping onboarding-docs render diff');
  });

  it('sits after the dead-word lint gate (0.6b) and before the authorized-domains gate (1)', () => {
    const gate06c = hook.indexOf('# ── 0.6c Onboarding-docs render diff gate');
    const gate06b = hook.indexOf('# ── 0.6b Dead-feature lint gate');
    const gate1 = hook.indexOf('# ── 1. Authorized-domains gate');
    expect(gate06c).toBeGreaterThan(gate06b);
    expect(gate06c).toBeGreaterThan(-1);
    expect(gate1).toBeGreaterThan(gate06c);
  });
});

describe('.githooks/pre-push · review-sheet byte gate (gate 0.6d)', () => {
  it('lists the review-sheet byte gate in the header gate inventory', () => {
    expect(hook).toContain('0.6d scripts/verify-review-sheet.mjs --check');
    expect(hook).toContain('deterministically and FAILS if the committed pair');
  });

  it('defines the gate block that routes verify-review-sheet.mjs --check through run_with_retry', () => {
    expect(hook).toContain('# ── 0.6d Review-sheet byte gate');
    expect(hook).toContain('run_with_retry 420 "review-sheet byte gate (deterministic capture)"');
  });

  it('timeboxes the gate with its OWN budget (420s), not the 90s run_verify timebox', () => {
    // The driver drives the LIVE app with two AI round-trips (up to ~90s
    // each), so running it under run_verify's 90s budget would always alarm
    // out. The gate must pass 420 into run_with_retry (same treatment as the
    // 1200s ship:ready capstone), never the plain run_verify function.
    expect(hook).toMatch(/^\s*run_with_retry 420 "review-sheet byte gate \(deterministic capture\)"/m);
    expect(hook).toMatch(/^\s*node scripts\/verify-review-sheet\.mjs --check --out \/tmp\/review-sheet-bytecheck\s*$/m);
  });

  it('gates on the web API key AND Chrome, skipping with notices when either is missing', () => {
    expect(hook).toContain('[ -n "$KEY" ] && [ -f scripts/verify-review-sheet.mjs ]');
    expect(hook).toContain('Chrome not found — skipping review-sheet byte gate');
    expect(hook).toContain('FIREBASE_WEB_API_KEY not set — skipping review-sheet byte gate');
  });

  it('names the re-capture failure reason', () => {
    expect(hook).toContain('"re-capture and commit the PNGs"');
  });

  it('sits after the docs-render gate (0.6c) and before the authorized-domains gate (1)', () => {
    const gate06d = hook.indexOf('# ── 0.6d Review-sheet byte gate');
    const gate06c = hook.indexOf('# ── 0.6c Onboarding-docs render diff gate');
    const gate1 = hook.indexOf('# ── 1. Authorized-domains gate');
    expect(gate06d).toBeGreaterThan(gate06c);
    expect(gate06d).toBeGreaterThan(-1);
    expect(gate1).toBeGreaterThan(gate06d);
  });
});

describe('.githooks/pre-push · production sign-in + Firestore sync gate (gate 3)', () => {
  it('lists the sign-in gate in the header gate inventory', () => {
    expect(hook).toContain('3. scripts/verify-prod-signin.mjs');
    expect(hook).toContain('needs FIREBASE_WEB_API_KEY + Chrome');
  });

  it('defines the gate block that routes verify-prod-signin.mjs through run_with_retry', () => {
    expect(hook).toContain('# ── 3. Sign-in + Firestore sync gate');
    expect(hook).toMatch(/^\s*run_with_retry 90 "production sign-in \+ Firestore sync"/m);
    expect(hook).toMatch(/^\s*node scripts\/verify-prod-signin\.mjs\s*$/m);
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

  it('defines the gate block that routes verify-profile-no-email.mjs through run_with_retry', () => {
    expect(hook).toContain('# ── 3b. Profile no-email gate');
    expect(hook).toMatch(/^\s*run_with_retry 90 "profile no-email walkthrough"/m);
    expect(hook).toMatch(/^\s*node scripts\/verify-profile-no-email\.mjs\s*$/m);
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
