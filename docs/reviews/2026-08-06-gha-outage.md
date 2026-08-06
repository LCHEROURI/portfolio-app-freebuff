# Postmortem, GitHub Actions "Service Unavailable" outage, 2026-08-06

**Severity**: Medium (CI only; the deployed app at https://portfolio-app-freebuff.vercel.app was never affected)
**Status**: Resolved (outage cleared); recovery steps documented in `docs/launch.md`; a manual re-verify input added so a past commit can be re-checked without a push
**Symptoms**: Every post-deploy gate for commit `8af5278` stayed **queued** for 15–18 minutes and then failed or was **cancelled at the "Set up job" step** with `Failed to resolve action download info. Error: Service Unavailable`. The next push (`62b94f8`) silently **cancelled** the in-flight re-run of `8af5278`'s CI run via the workflow's concurrency group.

## What happened

At roughly 17:00 UTC on 2026-08-06, GitHub's action-download service degraded (GitHub's status page showed **Actions: major_outage**, "Partial System Outage"). Every workflow run that needed to download an action from the marketplace (all of them — `actions/checkout`, `actions/setup-node`, `browser-actions/setup-chrome`) could not resolve its action download info. The jobs sat in the queue for many minutes, and the ones that eventually got a runner died in the **first step** — "Set up job" — before a single line of repo code ran.

Three runs were affected for `8af5278`:

| Run | Workflow | Result |
| --- | --- | --- |
| `31121501719` | CI (push) | jobs **cancelled** at Set up job, zero steps, no test output |
| `31121538927` | Deployed-hash gate | failed at Set up job |
| `31121538667` | Preview gate | failed at Set up job |

The failure log was unambiguous: `Failed to resolve action download info. Error: Service Unavailable` after several retries. No script of ours ever executed.

## How the outage presents (the signature)

A GitHub Actions outage that blocks action downloads is distinguishable from a code failure by three tells, all present in this incident:

1. **Runs stuck queued for a long time.** Normal runs on this repo start within seconds. During the outage, every run queued for 15–18 minutes (some much longer) because no runner could download the actions it needed.
2. **Failure at "Set up job", before any step runs.** The failing job's step list is empty (or the only entry is the implicit setup step), and `gh run view <id> --log-failed` prints nothing meaningful — there is no test output, no compile error, no assertion message. `git diff` and the pre-push hook prove the code is sound; CI never got far enough to disagree.
3. **`--log-failed` is empty and the failure message is the same generic error across every workflow.** `Service Unavailable` / `Failed to resolve action download info` appears identically in CI, Deployed-hash, and Preview gate logs. A real code failure would be specific to one job's output.

## How concurrency made it worse

`ci.yml` uses `concurrency: group: ci-${{ github.ref }}, cancel-in-progress: true`. That is deliberate (only the newest run of a branch should execute — the 8af5278-vs-62b94f8 overlap is exactly the case it was written for), but during an outage it bites twice:

- A **manual re-run** of an older commit's CI is still in the same `ci-main` group, so the next push **cancels it**. That is what happened: re-running `31121501719` for `8af5278` got cancelled mid-flight when `62b94f8` was pushed. By design, but painful when the older run was the one you actually wanted a green verdict on.
- `verify-deployed-hash.yml` and `preview-gate.yml` use `cancel-in-progress: false` on their own per-ref groups, so their *concurrency* is safe — they only failed because of the outage itself.

The key lesson: **a cancelled run during an outage does not mean the commit failed.** Check whether a newer push superseded it before assuming the code is broken.

## The fix / recovery steps

1. **Confirm the outage, not the code.** `curl -s https://www.githubstatus.com/api/v2/status.json` (or the status page) → if `Actions` is `major_outage`, stop diagnosing the repo. Cross-check the tell above: empty failed steps + `Service Unavailable`.
2. **Wait for the queue to drain.** Runs eventually settle once the action-download service recovers; some succeed on the first try after the outage window.
3. **Re-run what failed** once the status page is back to operational:
   ```bash
   gh run rerun <run-id>            # re-run failed jobs of a run
   gh run rerun <run-id> --failed   # same, explicit
   ```
   For the `8af5278` batch: the Deployed-hash gate rerun went **success** on the first attempt after the outage; the Preview gate needed one rerun; the CI push run was re-run but then cancelled by the `62b94f8` push (see above — its four real jobs had already passed on the first attempt).
4. **Never redeploy to "fix" an outage.** No code changed, no redeploy was needed, and the deployed app was unaffected the whole time. Pushing to trigger a rebuild does nothing for a run that died before downloading `actions/checkout`.

## What was verified after the dust settled

The `62b94f8` runs completed with **failure** on the first pass — but every one of the CI run's four real jobs had **succeeded** (Typecheck · Lint · Test · Build, Verify deployed email + rules, Verify authorized domains, Verify production sign-in + Firestore sync); the run's overall red came only from the checklist job cancelled at Set up job. The Deployed-hash and Preview gates were cancelled at Set up job with empty steps. After `gh run rerun`, the Deployed-hash gate for `8af5278` flipped to **success**.

## Prevention

- **`docs/launch.md` §4 "Known transient (GitHub Actions outage)"** now documents the exact symptom (queued runs / Set up job failures / `Service Unavailable`) and the recovery (wait, `gh run rerun <id>`, no redeploy), so the next outage is recognized in seconds instead of after a debugging detour.
- **Manual re-verify input.** `ci.yml` now accepts a `workflow_dispatch` input `commit_sha` — "Run workflow" → paste a past SHA → the full gate suite runs against that commit **without pushing**. Manual runs get their own concurrency group (`ci-reverify-<sha>`, `cancel-in-progress: false`), so a fresh push can *never* cancel a re-verify of an older commit mid-flight. That closes the specific trap this incident exposed: wanting a green verdict on a superseded commit.
- **Know the tell before you need it.** A red run whose failing jobs have empty step lists and whose log says `Service Unavailable` is infrastructure, not your code. The pre-push hook had already proven the same verifiers green locally before either push.

## Files

- `docs/launch.md` (§4 "Known transient (GitHub Actions outage)" note)
- `.github/workflows/ci.yml` (`workflow_dispatch` `commit_sha` input + per-sha manual concurrency group)
