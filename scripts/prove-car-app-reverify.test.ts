import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Contract test for scripts/prove-car-app-reverify.mjs — reads the REAL script
// and the REAL workflows from disk (never fixtures), and locks the promise the
// proof makes: the two CI dispatch phases (short sha → guard fast-fail before
// checkout; full 40-hex sha → full gate suite pinned to that commit) and, with
// --deploy, the re-deploy phase (dispatch "Deploy car app" with the full sha,
// assert the run succeeded, the verify-deployed job passed, live /api/version
// serves the requested commit, a new rollout serves, and the newest rollout
// carries the commit-sha label — then restore the main head). The
// cross-file consistency between what the script asserts and what the
// workflows actually emit is locked: if a workflow ever rewrites the guard
// message, renames the verify-deployed job, or drops a gate step, this test
// goes red instead of the proof passing vacuously.
const SCRIPT = readFileSync('scripts/prove-car-app-reverify.mjs', 'utf8');
const WORKFLOW = readFileSync('.github/workflows/car-app-ci.yml', 'utf8');
const DEPLOY_WORKFLOW = readFileSync('.github/workflows/deploy-car-app.yml', 'utf8');

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

// The deploy-phase consistency contract: every string the proof asserts must
// be something deploy-car-app.yml can actually produce. Throws on the first
// broken promise.
function expectScriptMatchesDeployWorkflow(script, workflow) {
  expect(script).toContain("DEPLOY_WORKFLOW_NAME = 'Deploy car app'");
  expect(script).toContain('backends/freebuff-car-app/rollouts');
  // The workflow must carry the job the proof asserts passed, the live probe
  // the proof curls, and the same guard messages as the CI workflow.
  expect(workflow, 'deploy workflow must carry the verify-deployed job the proof asserts').toContain('Verify live /api/version serves the pinned commit');
  expect(workflow).toContain('api/version');
  expect(workflow).toContain('commitFull');
  expect(workflow).toContain(GUARD_MSG_1);
  expect(workflow).toContain(GUARD_MSG_2);
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

describe('scripts/prove-car-app-reverify.mjs · --deploy re-deploy proof contract', () => {
  it('declares the deploy workflow name and the --deploy / --no-restore flags', () => {
    expect(SCRIPT).toContain("DEPLOY_WORKFLOW_NAME = 'Deploy car app'");
    expect(SCRIPT).toContain("deploy: args.includes('--deploy')");
    expect(SCRIPT).toContain("noRestore: args.includes('--no-restore')");
    expect(SCRIPT).toContain('--no-restore: leaving the past commit serving');
  });

  it('dispatches the deploy workflow with the full sha and asserts the labeled rollout serves it', () => {
    // The dispatch must go through the deploy workflow's commit_sha input.
    expect(SCRIPT).toContain("gh(['workflow', 'run', DEPLOY_WORKFLOW_NAME, '--ref', ref, '-f', `commit_sha=${commitSha}`])");
    // Phase 3 dispatches the TARGET commit; the restore re-dispatches the head.
    expect(SCRIPT).toMatch(/dispatchDeploy\(target, ref\)/);
    expect(SCRIPT).toMatch(/dispatchDeploy\(head, ref\)/);
    // The four load-bearing assertions:
    expect(SCRIPT).toContain('verify-deployed job passed');
    expect(SCRIPT).toContain('live /api/version serves the requested commit');
    expect(SCRIPT).toContain('live.commitFull === target');
    expect(SCRIPT).toContain('a NEW rollout is serving');
    expect(SCRIPT).toContain('newest rollout is labeled commit-sha=');
    expect(SCRIPT).toContain('label === target');
    // Restore: production must not be left on a past commit.
    expect(SCRIPT).toContain('live /api/version back on the main head');
    expect(SCRIPT).toContain('live.commitFull === head');
  });

  it('cross-checks the deploy-phase assertions against the real deploy workflow', () => {
    expectScriptMatchesDeployWorkflow(SCRIPT, DEPLOY_WORKFLOW);
  });

  it('fails when the deploy workflow drops the verify-deployed job (mutation drill)', () => {
    const mutated = DEPLOY_WORKFLOW.replace(
      'Verify live /api/version serves the pinned commit',
      'Verify live version',
    );
    expect(mutated).not.toBe(DEPLOY_WORKFLOW);
    expect(() => expectScriptMatchesDeployWorkflow(SCRIPT, mutated)).toThrow();
  });

  it('fails when the proof renames the deploy workflow away from the real name: (mutation drill)', () => {
    const mutated = SCRIPT.replace("DEPLOY_WORKFLOW_NAME = 'Deploy car app'", "DEPLOY_WORKFLOW_NAME = 'Deploy car application'");
    expect(mutated).not.toBe(SCRIPT);
    expect(() => {
      expect(mutated).toContain("DEPLOY_WORKFLOW_NAME = 'Deploy car app'");
    }).toThrow();
  });
});