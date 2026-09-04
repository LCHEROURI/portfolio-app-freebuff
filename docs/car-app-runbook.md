# Car-app pipeline runbook

Everything operational about deploying and watching **freebuff-car-app** (Buy
Smart with Larry) on Firebase App Hosting. Facts verified against the live
pipeline; when this doc and the workflows disagree, the workflows win.

- **Backend:** `freebuff-car-app` · project `portfolio-app-freebuff2` · `us-central1`
- **Live URL:** https://freebuff-car-app--portfolio-app-freebuff2.us-central1.hosted.app
- **Repo layout:** monorepo — the app lives in `freebuff-car-app/`; deploys
  only trigger on changes under that path (plus the deploy workflow itself).

## 1. How deploys work

```
push to main (freebuff-car-app/** changed)
  → car-app CI          (.github/workflows/car-app-ci.yml — tsc, jest, build)
  → Deploy car app      (.github/workflows/deploy-car-app.yml)
      gates: tsc → jest → next build
      deploy: scripts/deploy-car-app.sh
        zip source (honors .gitignore)
        → upload to App Hosting sources bucket
        → builds.create   (labels: commit-sha, run-url)
        → rollouts.create (validate-only, then real; same labels)
        → poll to terminal state
      provenance: GitHub Deployment record + run summary
  → live site serves the new rollout
```

The script mirrors what `firebase deploy --only apphosting` does internally,
because the CLI exposes no label flags — this is what makes every rollout
self-describing without the Console GitHub App link.

### Deploy manually

- **From GitHub (normal path):** `gh workflow run deploy-car-app.yml` — deploys
  current `main`.
- **From a local checkout** (e.g. pinned to an older commit for rollback):
  ```bash
  gcloud auth login   # or: GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
  git checkout <sha>
  GITHUB_SHA="$(git rev-parse HEAD)" \
  RUN_URL="https://github.com/LCHEROURI/portfolio-app-freebuff" \
  bash scripts/deploy-car-app.sh
  ```
  The script polls until the rollout reaches a terminal state and prints the
  rollout id (also exported as `ROLLOUT_NAME` in CI for the run summary).

## 1b. One-time key flip: MarketCheck live inventory

`scripts/watch-marketcheck-key.sh` (running copy: `/Users/Shared/freebuff/`,
launchd label `com.freebuff.marketcheck-watcher`) polls for the
`MARKETCHECK_API_KEY` GitHub secret every 30s for up to a week. The moment the
key appears it dispatches `deploy-car-app.yml`, watches the rollout, then
probes live `/api/inventory` (with and without budget params):
`source=marketcheck` on both = success (exit 0, webhook posted if
`ALERT_WEBHOOK_URL` is set in the launcher env); `demo/upstream-error` after a
retry = key rejected upstream (exit 4). Log: `/tmp/marketcheck-watcher.log`,
state: `/tmp/marketcheck-watcher.state`. Remove the job with
`launchctl bootout gui/$(id -u)/com.freebuff.marketcheck-watcher` once the
flip is confirmed.

## 2. Rollback

Preferred, fully scriptable — redeploy the last known-good commit:

```bash
git checkout <last-good-sha>
GITHUB_SHA="$(git rev-parse HEAD)" RUN_URL="…repo url…" bash scripts/deploy-car-app.sh
```

A new labeled rollout is created and traffic switches when it succeeds — the
previous build keeps serving until then. If the bad change is in git history,
`git revert` + push gives you the same result through the automatic pipeline
(and auto-closes any open deploy-failure issue on success).

The Firebase Console's Rollouts tab also offers a rollback control on older
rollouts; use it only for one-off emergencies — it bypasses the labeling and
the issue lifecycle (and the next push will redeploy over it).

## 3. Reading the rollout history

Every rollout carries its provenance:

| Field | Where | Value |
|---|---|---|
| `labels["commit-sha"]` | build **and** rollout | full commit SHA |
| `annotations["run-url"]` | rollout | the Actions run that shipped it |
| `annotations["commit-sha"]` | rollout | full SHA (labels can't hold URLs — values are restricted to `[a-z0-9-_]`) |
| archive `description` | build source | `commit <short-sha>` |

**Console:** project `portfolio-app-freebuff2` → Build → App Hosting →
`freebuff-car-app` → **Rollouts** tab.

**CLI/API one-liner** (newest first — the raw list is *not* newest-ordered):

```bash
TOKEN=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://firebaseapphosting.googleapis.com/v1beta/projects/portfolio-app-freebuff2/locations/us-central1/backends/freebuff-car-app/rollouts?pageSize=50" \
| jq -r '[.rollouts[]] | sort_by(.createTime) | reverse | .[0] |
        "\(.name | split("/")[-1])  \(.state)  \(.labels["commit-sha"] // "no-sha")"'
```

**Machine-readable, from the app itself:**

```bash
curl -s https://freebuff-car-app--portfolio-app-freebuff2.us-central1.hosted.app/api/version | jq .
# { service, commit, commitFull, rolloutId, deployedAt } — nulls on a dev build
curl -s …/api/version | jq -e '.commit != null'   # 0 = deployed build serving
```

## 4. Where alerts land

One shared **`deploy-failure`-labeled GitHub issue** is the single alert
channel (repo owner is assigned → a notification lands in your GitHub
inbox). Two producers feed it:

| Producer | Catches | Recovery |
|---|---|---|
| `deploy-car-app.yml` → `notify-failure` | its own deploy run failing | `notify-success` auto-closes on the next successful deploy |
| `rollout-health.yml` (every 30 min + dispatch) | FAILED rollouts from *any* source (native git rollouts, manual CLI), rollouts stuck `PROGRESSING` > 25 min, **stale** deploys (main's last car-app commit newer than what the live rollout serves), and **serving- or app-level failures the rollout API can't see** — the live `/api/version` unreachable, non-200/non-JSON, or a null commit (`unprovenanced`), or `/status` not reporting its self-check as passing (`degraded`, catching in-process app failures a bare 200 cannot) | same issue auto-closed when the watch classifies `healthy` |

Design rules: only one open `deploy-failure` issue exists at a time (new
failures comment on it); a run cancelled by a newer push never alerts (the
newer run owns the outcome); the scheduled watch is the safety net that keeps
working even after deploys move off Actions.

Optional: set the `ALERT_WEBHOOK_URL` secret to a Slack/Discord incoming
webhook and failures also ping that channel — no other change needed.

Alerts are severity-routed (see `scripts/check-rollout-health.sh`, which emits
`severity=page|warning` with every verdict):

| Severity | Outcomes | Webhook channel |
|---|---|---|
| **page** | deploy-failure run alerts, rollout `failed` / `stuck`, serving outages (`unreachable` / `unprovenanced` / `degraded`) | `ALERT_WEBHOOK_URL` — the channel that gets pinged |
| **warning** | rollout `stale` (main advanced past what serves; the app still works) | `ALERT_WEBHOOK_URL_QUIET` — a silent/log-only channel; if the secret is unset the warning lands as the deploy-failure issue only, never a page |

## 5. Gotchas (each one bit us once)

- **Label values** can't contain `:` or `/` — URLs belong in `annotations`.
- **The rollouts list is not newest-first** — always sort by `createTime`.
- **The upload honors `.gitignore`** — never gitignore `.env.production`; the
  deploy script writes it (public SHA/rollout/time only) and it must reach the
  cloud build or `/api/version` reports nulls.
- **`firebase deploy` may exit while the rollout is still `PROGRESSING`** —
  the script polls instead of trusting the CLI exit.
- **Build ids** (`build-YYYY-MM-DD-NNN`) are derived from *both* builds and
  rollouts lists — deriving from builds alone collides (HTTP 400).
- **Stale verdicts ignore parent-only pushes** — the health watch compares
  against the last commit *touching `freebuff-car-app/`*, not HEAD.
