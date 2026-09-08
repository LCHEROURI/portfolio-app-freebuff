import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Contract test for scripts/prove-car-app-reverify.mjs — reads the REAL script
// and the REAL workflow from disk (never fixtures), and locks the promise the
// proof makes: the two dispatch phases (short sha → guard fast-fail before
// checkout; full 40-hex sha → full gate suite pinned to that commit) and the
// cross-file consistency between what the script asserts and what the
// workflow actually emits. If the workflow ever rewrites the guard message or
// renames a gate step, this test goes red instead of the proof passing
// vacuously.
const SCRIPT = readFileSync('scripts/prove-car-app-reverify.mjs', 'utf8');
const WORKFLOW = readFileSync('.github/workflows/car-app-ci.yml', 'utf8');

const GUARD_MSG_1 = 'is not a full 40-hex commit sha. Paste the full sha';
const GUARD_MSG_2 = '— a short sha cannot be checked out.';
const GATE_STEPS = ['Typecheck', 'Test', 'Build'];

/**
 * The cross-file consistency contract: every string the proof asserts in a
 * run's log must be something the workflow can actually produce. Throws with
 * the first broken promise.
 */
function expectScriptMatchesWorkflow(script, workflow) {
  expect(script).toContain(GUARD_MSG_1);
  expect(script).toContain(GUARD_MSG_2);
  // The workflow's guard step must emit both messages the proof asserts.
  expect(workflow, 'workflow must emit the guard message the proof asserts').toContain(GUARD_MSG_1);
  expect(workflow, 'workflow must emit the fix hint the proof asserts').toContain(GUARD_MSG_2);
  expect(workflow, 'workflow must confirm a valid sha').toContain('is a full 40-hex commit');
  // Every gate step the proof requires to RUN must exist as a step in the
  // workflow — otherwise "step ran" could never be asserted.
  for (const step of GATE_STEPS) {
    expect(workflow, `workflow must contain the gate step ${step}`).toMatch(
      new RegExp(`name: ${step}`),
    );
  }
}

describe('scripts/prove-car-app-reverify.mjs · dispatch proof contract', () => {
  it('declares the exact workflow name, guard messages, and gate steps it proves', () => {
    expect(SCRIPT).toContain("WORKFLOW_NAME = 'Car app CI'");
    expect(SCRIPT).toContain(GUARD_MSG_1);
    expect(SCRIPT).toContain(GUARD_MSG_2);
    for (const step of GATE_STEPS) {
      expect(SCRIPT).toContain(`'${step}'`);
    }
  });

  it('dispatches car-app-ci twice: a short sha and the full 40-hex sha', () => {
    // Phase 1: the short sha (first 7 hex of the target) must hit the guard.
    expect(SCRIPT).toMatch(/const short = target\.slice\(0, 7\);/);
    expect(SCRIPT).toMatch(/dispatchCommitSha\(short, ref\)/);
    // Phase 2: the full 40-hex target must run the gate suite.
    expect(SCRIPT).toMatch(/dispatchCommitSha\(target, ref\)/);
    // Both go through the workflow's commit_sha input on the same ref.
    expect(SCRIPT).toContain("'-f', `commit_sha=${commitSha}`");
  });

  it('asserts the short-sha phase failed at the guard with checkout skipped', () => {
    expect(SCRIPT).toContain("job.conclusion === (expectFailure ? 'failure' : 'success')");
    expect(SCRIPT).toContain(`log.includes(GUARD_MSG_1)`);
    expect(SCRIPT).toContain(`log.includes(GUARD_MSG_2)`);
    expect(SCRIPT).toContain("checkoutStep?.conclusion === 'skipped'");
    expect(SCRIPT).toContain('guard ran before checkout');
  });

  it('asserts the full-sha phase pinned the checkout and ran every gate step', () => {
    expect(SCRIPT).toContain('log.includes(`git checkout --progress --force ${fullSha}`)');
    expect(SCRIPT).toContain("log.includes('is a full 40-hex commit')");
    expect(SCRIPT).toContain("step?.conclusion === 'success'");
    expect(SCRIPT).toMatch(/for \(const stepName of GATE_STEPS\)/);
  });

  it('cross-checks every asserted message/step against the real workflow', () => {
    expectScriptMatchesWorkflow(SCRIPT, WORKFLOW);
  });

  it('fails when the workflow drops the guard message (mutation drill)', () => {
    // The consistency contract must have discriminating power: a workflow
    // that no longer emits the guard message the proof asserts must fail the
    // check, or the proof would pass against a workflow that can't produce
    // the message.
    const mutated = WORKFLOW.replace(GUARD_MSG_1, 'no guard message here');
    expect(mutated).not.toBe(WORKFLOW);
    expect(() => expectScriptMatchesWorkflow(SCRIPT, mutated)).toThrow();
  });

  it('parses the dispatched run id from gh workflow run output', async () => {
    const { runIdFromDispatchOutput } = await import('./prove-car-app-reverify.mjs');
    expect(
      runIdFromDispatchOutput('https://github.com/LCHEROURI/portfolio-app-freebuff/actions/runs/34209408397'),
    ).toBe(34209408397);
    expect(runIdFromDispatchOutput('no run url here')).toBeNull();
  });
});