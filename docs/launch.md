# 🚀 Launch checklist — go-live requirements & verified state

Everything a launch or handoff needs to know: the identity of the live
deployment, the env vars it depends on, and the exact verification gates that
prove it works. Written after the go-live pass on **2026-08-05/06** so the
next launch (or a new maintainer) doesn't re-derive any of it.

> **New here?** Start with the README's **Handoff — read this first** section
> (`../README.md#handoff--read-this-first`) — architecture, the 13
> verification gates, and the three-secret-store reality in one page. This
> checklist is the operational go-live companion to that overview.

> This is the checklist companion to the README's *Production environment on
> Vercel* section. When the two disagree, the README's deeper setup prose wins;
> this doc is the short version.

---

## 1. Identities (get these right — they were wrong once)

| What | Value | Notes |
| --- | --- | --- |
| **Firebase project** | `portfolio-app-freebuff2` | The **2 matters**. The old CLI-created project `portfolio-app-freebuff` is deleted; `meal-planner-lcherouri` belongs to the meal-planner app and must not be reused. A CI guard greps for a bare `portfolio-app-freebuff` used as a Firebase project id and fails the run. |
| **Vercel project / GitHub repo** | `portfolio-app-freebuff` (no 2) | The deployment surface — deliberately *not* `-freebuff2`. |
| **Production URL** | `https://portfolio-app-freebuff.vercel.app` | Live. Vercel auto-deploys on push to `main`. The exact deployed commit is reported by `node scripts/verify-deployed-hash.mjs` (reads `VERCEL_TOKEN` from env → `.env.local` → the Vercel CLI auth store; `--expect <sha>` asserts it for CI / pre-push, `--check-local` compares against local HEAD). |
| **Auth domains** | the `portfolio-app-freebuff2.firebaseapp.com` / `.web.app` defaults + `portfolio-app-freebuff.vercel.app` + the exact preview URLs | Wildcards (`portfolio-app-freebuff-*.vercel.app`) are **rejected** by Firebase; each preview URL must be listed individually (`.freebuff/add-auth-domains.py` manages the list, `--prune` drops old preview URLs). |

## 2. Vercel Production env vars (names only — values live in Vercel)

```bash
# Firebase identity + data — the on/off switch for the live-data layer.
# Missing any of these six silently reverts the app to demo mode.
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID

# AI layer (OpenRouter) — absent degrades to deterministic text, no crash.
OPENROUTER_API_KEY
OPENROUTER_MODEL            # optional; per-user Settings picker overrides

# Automation cron (report generation)
CRON_SECRET                 # Vercel Cron auth header; keep in sync with .env.local
REPORT_OWNER_ID             # real Firebase uid so cron reports reach your Activity feed
REPORT_WEEKLY_DAY           # optional (1 = Mon)
REPORT_STALE_DAYS           # optional (7)

# Server-side data (cron reads the same Firestore the client writes)
FIREBASE_SERVICE_ACCOUNT    # service-account JSON for portfolio-app-freebuff2

# Live integrations (both need the matching NEXT_PUBLIC_LIVE_* flag = 1)
GITHUB_TOKEN
VERCEL_TOKEN
VERCEL_TEAM_ID
```

Deliberately **not** set in Production: `NEXT_PUBLIC_DEMO_OVERRIDE` — it was
removed so API routes stop trusting the spoofable `x-app-user` header. Set it
only on a separate demo deployment.

## 3. GitHub repo secrets (for the post-deploy CI gates)

Same values as above where shared: `CRON_SECRET`, `FIREBASE_WEB_API_KEY`,
`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
`VERCEL_PROTECTION_BYPASS`. The `verify-prod-signin` CI job is gated on
`FIREBASE_WEB_API_KEY`.

## 4. The verification gates — run all of them before go-live

Each exits nonzero on failure. Read secrets from env, then `.env.local`.

| Gate | Requires | What it proves |
| --- | --- | --- |
| `npm run verify:disk-headroom` | — | Local Data-volume headroom: the machine's Data volume must stay under `DISK_LIMIT_PCT` (default 90) — a full disk is what caused the SQLite "disk I/O error" on button clicks and it silently breaks the Chrome/npm verifiers. Reads `df` (root-mount fallback on non-macOS), exits 1 over the limit, exits 0 on pass **and** when `df` is unavailable (skip-not-fail); `DISK_LIMIT_PCT` and the non-blocking warning tier `DISK_WARN_PCT` (default 85 — warns but still passes, so a creeping disk is surfaced before the hard limit) are env-overridable with a numeric guard. No secrets, no network, instant — runs **first** in `verify:all` and as pre-push gate 0.05. Deliberately local-only (a CI runner's disk is not the developer's) |
| `node scripts/maintain-conv-db.mjs` | — | Conv DB WAL maintenance on the LOCAL machine's conversation DB (`.freebuff/desktop-v2.db`): when the `-wal` sidecar exceeds the 2 MiB threshold (default, `CONV_DB_MAINTAIN_THRESHOLD` overrides) it runs a TRUNCATE checkpoint with busy-retry; idles at/below the threshold and skips-not-fails when sqlite3 or the DB is absent. Emits `wal-idle` / `wal-truncated` / `wal-busy` / `wal-error` sub-rows (the `(local)` suffix — this is a local-machine probe, not a deployed-app gate). Deliberately local-only like disk-headroom — a CI runner's DB is not the developer's, so no ci.yml step runs it |
| `npm run verify:token-health` | `VERCEL_TOKEN` | Stored `VERCEL_TOKEN` is alive: reads it (env → `.env.local` → CLI store), calls `GET /v2/user/tokens`, and reports the active token's name + expiry (or "no expiration"); a revoked token exits 2 with the paste-a-fresh-token guidance. Runs **first** in `verify:all` so a dead credential is caught in ~1s before any gate that depends on it |
| `npm run verify:vercel-env` | `VERCEL_TOKEN` (+ Vercel CLI) | Vercel production env **matches** `.env.local`: pulls the decrypted values via `vercel env pull`, asserts every local key exists in Vercel prod with an identical value (report shows names + value lengths only, never the secrets), reports Vercel-only vars as informational, and classifies GitHub secrets — CI-only ones (e.g. `VERCEL_ORG_ID`) are expected, not drift, while a GitHub secret that `.env.local` has but Vercel prod lacks fails the gate. Vercel's system-injected build vars (`VERCEL_OIDC_TOKEN`, `VERCEL_URL`, the `VERCEL_GIT_*` metadata) rotate every build/deploy and are exempted from comparison (reported as informational, lengths only), so an untrimmed `vercel env pull` file passes; real project vars sharing the prefix (`VERCEL_TOKEN`, `VERCEL_TEAM_ID`) stay value-compared. Exits 1 on drift, 2 on an invalid token. Requires `VERCEL_TOKEN` + the Vercel CLI; `gh` degrades to skip-not-fail |
| `npm run verify:cron-reports` | `CRON_SECRET` | Deployed `/api/cron/reports` 401s without auth; daily + weekly report bodies carry the friendly `(DeepSeek Chat)` heading and raw-id `Model:` footer; weekly winner-recommendation section present; **no report carries an `email` envelope** (the sweep shows as its own row in `verify:all`'s summary). Reports are composed in-app only — this proves the composed bodies still ship for the in-app Reports page |
| `npm run verify:firestore-rules` | `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY` | Rules on `portfolio-app-freebuff2`: portfolio write/read under the user's uid, cross-user denied |
| `npm run verify:auth-domains` | `FIREBASE_WEB_API_KEY` | `/api/status?project=<domain>` reports `authDomains.ok` for the shipping domain |
| `node scripts/verify-prod-signin.mjs` | `FIREBASE_WEB_API_KEY`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (+ Chrome) | AuthGate renders, email/password + Google buttons present, both IdPs enabled (admin API), sign-in releases into the Command Center, Firestore write/read sync proven; `[3b]` asserts the classic OAuth client |
| `node scripts/verify-google-idp.mjs` | `FIREBASE_WEB_API_KEY`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `createAuthUri` resolves `google.com` with a classic web client id; admin API confirms the IdP record is enabled |
| `npm run verify:review-sheet` | `FIREBASE_WEB_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (+ Chrome) | Drives the deployed Model Comparison page end to end: seeds a live fixture under a throwaway user, generates two AI winner recommendations, opens the Print-all review sheet in the preview window, and asserts BOTH numbered entries render with the friendly model label (DeepSeek Chat). Same credential family as prod-signin plus the service account for seeding. Emits sub-rows in `verify:all`'s summary (preview / entries / model label); run-to-run AI note drift is accepted (structure-only assertions) — the committed PNG pair is byte-stable via deterministic capture (gate 0.6d, see the sub-rows note below) |
| `npm run verify:deployments` | `FIREBASE_WEB_API_KEY` | Deployed `/api/deployments` feed end to end with a throwaway Identity Toolkit user (minted from the web API key, deleted after): unauthenticated calls get 401; an authenticated call returns 200 + `ok:true`; at least one Firebase Hosting row (from the `firebasehosting.googleapis.com` feed via the SA-minted token) and one Vercel row (name→id resolution) are present with HEALTHY health checks. Guards the wrong-host 404 and the name-ignored-filter regressions the feed hit before. Emits `auth-gate` / `firebase-row` / `vercel-row` sub-rows in `verify:all`'s summary |
| `npm run verify:deployed-pdf` | `FIREBASE_WEB_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `REPORT_OWNER_ID` | Deployed `/api/print/pdf` renders a REAL PDF as the real owner (SA-minted custom token → owner idToken): 200 + `application/pdf` + `%PDF-` body + attachment filename; unauthenticated POSTs get 401. The route that 503'd on Vercel until serverless Chromium shipped |
| `node scripts/verify-auth-domains.mjs` | `FIREBASE_WEB_API_KEY` | same as `verify:auth-domains` with throwaway-user token |
| `npm run verify:deployed-hash -- --expect <sha>` | `VERCEL_TOKEN` | Production is actually serving the expected commit — the exact gate the `deployed-hash` CI workflow and pre-push hook run. Pass the commit you expect to be live (`git rev-parse origin/main` for the last pushed commit; `--check-local` compares against local HEAD instead) |
| `npm run verify:import-surface` | — | Static import-surface lint over `scripts/` + `lib/` + `app/` (TS-compiler-AST scan): no re-exported imports and no unused imports. No secrets, no network — also wired into `npm run lint`, the pre-push hook (gate 0.6), and CI's lint step |
| `npm run verify:dead-words` | — | Repo-wide sweep for dead-feature phrasing in code comments and docs: the removed report-email wording plus the removed integrations (the old data store, the delivery sender) can never silently return. The env-identifier phrases are **derived from `REMOVED_ENV_VARS` in `lib/integrationVarLinks.ts`** — the same source of truth the Integrations lock test loops over — so the banned list and the lock can never drift: add a removed identifier to the array and both extend automatically. Fails loudly if the array is missing or empty. Skips `docs/reviews/` (historical records), the linter's own files (which must quote the phrases), the source-of-truth array lines, and the removed-var lock lines in `lib/integrationVarLinks.test.ts` (which must quote the dead names to prove they resolve to null). No secrets, no network — also wired into `npm run lint`, the pre-push hook (gate 0.6b), and CI's lint step |

Run **all sixteen in one command** with `npm run verify:all` — it preflights the
drift guard above, runs every gate sequentially against the production URL
(or `--app <url>` to target a preview/local server), dedupes the two
auth-domains rows (they share one script), and prints a summary table,
exiting nonzero on any failure. The table also shows an `Onboarding-doc
pipeline diagram presence` row — a static companion check (not a 12th gate:
it stays out of the §4 gate list) that re-runs the same `When each gate
runs:` picture check the drift guard's `[3e/4]` step performs, so the
picture's presence is visible in the one-command checklist, not just in the
preflight scrollback. `--only a,b` / `--skip a,b` narrow a run;
`--expect <sha>` forwards a deployed-hash assertion into the runner.

**One-command go-live answer:** `npm run ship:ready` answers "are we ready to
ship?" in a single command — it asserts the working tree is clean (nothing
staged, unstaged, or untracked), runs the full `verify:all` suite above
against production, and prints a single `SHIP READY` / `SHIP BLOCKED`
verdict with a nonzero exit when blocked. It is deliberately NOT a §4 gate
row (the drift guard requires §4 to match verify-all's gate list exactly); it
is the wrapper that runs them all.

**One-command release:** `npm run ship:go -- "<message>"` takes the whole
release from working tree to proven live build in a single command — it
commits the entire working tree with the given message (default
`chore(release): ship working tree via ship:go`), pushes to `origin/main`
(the pre-push hook runs the full local gate suite first), polls the canonical
production URL via `verify-deployed-hash.mjs --url … --expect <sha>` until
the deployment serving it carries the pushed commit (default 6 minutes at
15s intervals; `--max-wait <sec>` and `--poll <sec>` tune it), then runs
`npm run ship:ready` against the deployed build — so `SHIP READY` is proven
against what is actually live, not just local HEAD. `--dry-run` previews the
commit/push/wait plan without touching anything. `--branch <name>` pushes a
non-main branch; the wait poll still targets the canonical production URL,
which only tracks main — a non-main push has no production deployment to
prove, so the poll times out (exit 1) rather than claiming success. Exit
codes: 0 ready · 1 a step failed (push or deploy timeout) · 2
`VERCEL_TOKEN` invalid/revoked · 3 git unusable — and the final
`ship:ready` step passes its own exit code through unchanged.

When each gate runs (same picture as the README handoff section):

```text
   ┌───────────────────────────────────────────────────────────────┐
   │  LOCAL — every git push (.githooks/pre-push)                  │
   │  runs the 16 verify:all gates + drift guards (timeboxed); a  │
   │  hook gates 0.6/0.6b/0.6c/0.6d (lints + render byte gates);   │
   │  dirty tree or any failure ABORTS the push                    │
   └──────────────────────────────┬────────────────────────────────┘
                                  │  push lands only when green
                                  ▼
   ┌───────────────────────────────────────────────────────────────┐
   │  npm run ship:go — the one-command path                       │
   │  commit → push → wait for the Vercel deploy → re-run          │
   │  ship:ready against the LIVE build                            │
   └──────────────────────────────┬────────────────────────────────┘
                                  │  the push fires, in parallel
                                  ▼
   ┌───────────────────────────────────────────────────────────────┐
   │  GITHUB ACTIONS — ci.yml (push event)                         │
   │  · Typecheck · Lint · Test · Build                            │
   │  · Verify launch checklist matches scripts                    │
   │  · Verify authorized domains                                  │
   │  · Verify production sign-in + Firestore sync                 │
   │  · Verify deployed cron reports + rules (secret-gated)        │
   └──────────────────────────────┬────────────────────────────────┘
                                  │  after Vercel finishes building
                                  ▼
   ┌───────────────────────────────────────────────────────────────┐
   │  DEPLOYMENT_STATUS GATES (per preview/production deploy)      │
   │  · Preview gate — auto-authorize + verify the deployed domain │
   │  · Deployed-hash gate — live build serves the pushed commit   │
   │  · Gallery — screenshots the deployed preview                 │
   └───────────────────────────────────────────────────────────────┘
```

**Sub-rows in the summary table:** capture gates emit
`VERIFY-SUBRESULT|<name>|<PASS|FAIL>` markers that `verify:all` renders as
indented rows directly under the parent gate. A sub-row is **visibility only**
— the parent gate's exit code still governs the run. Not every sub-row appears
on every run: a sub-check that could not run emits **no row at all**, so an
absent row means *check skipped*, never *check passed*. The conditional rows
are:

- `admin-config` (under `verify:google-idp`) — only when
  `FIREBASE_SERVICE_ACCOUNT` is configured locally, because the admin-API
  cross-check needs a service-account token to mint.
- `email-idp-config` and `google-idp-config` (under `verify-prod-signin`) —
  only when the service account is configured AND the Firebase project id is
  known; the admin-API IdP probes cannot run without both.
- `firestore-sync` (under `verify-prod-signin`) — only when a throwaway user
  is minted (the default); fixed-credential runs (`--email`/`--password`)
  skip the Firestore REST probe and prove sync via the shell render instead.
- `verify-deployed-hash`'s `alias-drift`, `expect-match`, and `check-local`
  rows follow the same contract — each appears only when its flag
  (`--compare-url`, `--expect`, `--check-local`) actually ran and compared two
  shas.
- The `verify:review-sheet` sub-rows (`review-sheet-preview`,
  `review-sheet-entries`, `review-sheet-model-label`) are the OPPOSITE — always
  emitted, because the gate asserts structure only (title, both numbered
  entries, friendly model label) and never pixel bytes. The accepted run-to-run
  text drift lives here: the structural gate (and any capture without the
  deterministic flag) renders the LIVE AI winner note, which legitimately
  differs on every run — that drift is by design and never gated. The
  committed `screenshots/review-sheet-*.png` pair is the exception: it must be
  byte-stable, so the pre-push hook's gate 0.6d re-captures it in
  deterministic mode (`REVIEW_SHEET_DETERMINISTIC` pins the note to a fixture
  string and the winner to the top-`overallScore` candidate) and fails the push
  until the committed pair matches the deterministic render. Commit the pair
  whenever the Model Comparison page or the print-all builder changes.

So when reading the `verify:all` table, a missing conditional row is expected
on a machine without the service account (or without `--expect`): it means the
sub-check was skipped, not that it failed — and never that it passed.

CI runs the cron-reports + firestore-rules + auth-domains gates after every push
(`ci.yml`), a sign-in gate, and `preview-gate.yml` validates every Vercel
preview URL via `deployment_status`. A separate `verify-deployed-hash.yml`
workflow (also `deployment_status`-triggered) closes the GitHub↔Vercel drift
gap in CI: it resolves the freshly deployed `target_url` via the Vercel API
(`verify-deployed-hash.mjs --url <target_url> --expect <deployment.sha>`) and
fails if the commit Vercel is serving doesn't match the pushed head — gated on
`VERCEL_TOKEN`. For **production** deployments it also runs the alias-routing
drift watch (`--compare-url https://portfolio-app-freebuff.vercel.app`): the
canonical alias must serve the same commit as the deployment-specific
`target_url`; previews skip it because their URL legitimately differs. The local `.githooks/pre-push` hook runs
the same verifiers (timeboxed 90s each) before any push, and now also runs the
deployed-hash gate first: it resolves the CANONICAL production URL via the v13
by-host lookup (`verify-deployed-hash.mjs --url
https://portfolio-app-freebuff.vercel.app --expect <origin/main tip>`) and
asserts it serves the last pushed commit, so a deploy that silently failed is
caught before the next push piles on top. Targeting the canonical URL directly
subsumes the old alias-routing drift watch locally (if the alias pointed at an
older/newer build, `--expect` fails right there) and — critically — needs NO
team-scope resolution, so a team-scoped token or a missing `defaultTeamId` can
never send it down the v6 list branch and 403 the way the bare `--expect` form
did. Because the alias can transiently lag the latest deploy right after a
push, the hook **retries once after a 30s backoff** before deciding — a
transient lag clears and the push proceeds, a genuine mismatch fails both
attempts and aborts. It skips (with a notice) on first push to an empty main,
or when `VERCEL_TOKEN` isn't set locally. `npm run verify:all` runs the same
canonical-URL `deployed-hash` gate (`--url` + `--check-local`/`--expect`), so
the one-command checklist covers it too.

**Final pre-push capstone:** the hook ends with the `ship:ready` verdict
(`scripts/ship-ready.mjs`, 20-minute budget — the full `verify:all` suite far
exceeds the 90s per-verifier timebox). Before the capstone, the hook also
runs its static and render gates — **0.6** import-surface, **0.6b** dead-words,
**0.6c** docs-render diff, **0.6d** review-sheet byte gate (re-renders the
onboarding-docs and review-sheet PNGs and fails until the committed
screenshots match; the review-sheet capture runs in deterministic mode). After
every individual gate passes, it
asserts the working tree is clean (nothing staged, unstaged, or untracked — a
dirty tree means the pushed commit cannot match the code you just ran) and
runs the complete sixteen-gate suite against production, printing a single
`SHIP READY` / `SHIP BLOCKED` verdict. Any nonzero exit aborts the push — so
the same one-command verdict the go-live checklist uses is enforced at the
point of no return. `SKIP_VERIFY_SIGNIN=1` bypasses it like every other gate.
Note the deployed-hash gate inside `verify:all` uses `--check-local`
(warn-only, never fails) precisely because the commit being pushed is not yet
live during a pre-push — the full drift assertion belongs to CI's
`deployment_status` gate after the deploy lands.

**Known transient:** the auth-domains gate can briefly FAIL right after a
deploy because the deployed `/api/status` serves a 2-minute cached
`getProjectConfig` snapshot. Re-run it; it passes with `refresh=1`.

**Known transient (GitHub Actions outage):** a gate stuck **queued** for many
minutes, or one failing at the **Set up job** step with `Service Unavailable`
/ `Failed to resolve action download info`, means GitHub's action-download
service is degraded — not your code. No redeploy is needed: wait for the
outage to clear and re-run the run (`gh run rerun <id>`); the deployed app is
unaffected.

### Disk full emergency

A full boot disk is the one failure mode that silently breaks everything this
checklist's gates depend on. It was the root cause of the Freebuff app's
SQLite "disk I/O error" on button clicks (the conversation DB writes on every
click), and it breaks the Chrome `/tmp` profiles and npm steps the verifiers
need. The pre-push hook (gate 0.05) already blocks a push past `DISK_LIMIT_PCT`
(default 90) and warns non-blocking over `DISK_WARN_PCT` (default 85) — but
when you're already inside the app and clicks are failing, recover first, then
verify:

```bash
npm run verify:disk-headroom                       # what's the damage? warn 85 / fail 90
DISK_LIMIT_PCT=80 node scripts/verify-disk-headroom.mjs   # tighten the limit for a quick recheck
```

**What to clear** — the full safe-to-clear list (npm cache, Chrome's on-device
AI model store, Docker VM/installer data, wallpaper assets, go/playwright/
antigravity/iCloud/Codex/pnpm/pip caches, logs — all regenerable, none of it
your data) lives in the README's **Disk headroom** section:
[`../README.md#disk-headroom`](../README.md#disk-headroom). Never touch
`~/Library/Application Support/Google` (your real Chrome profile — history,
passwords, extensions) or app data with login state. Clearing the list
recovered ~48Gi on 2026-08-08 (90% → 67%).

**After freeing space** — re-run `npm run verify:disk-headroom` until it prints
`RESULT: PASS` (a `⚠ WARNING` at/above 85% still passes — it is the heads-up
to free space before the hard 90% line), then `npm run verify:conv-db` to
prove the conversation DB's write path (scratch write → WAL checkpoint →
integrity) is clean again. `verify:conv-db` is a manual one-shot (it checks the
Freebuff app's local store, so it is deliberately not in the pre-push hook or
CI); `verify:disk-headroom` runs again on the way out and will block the push
if the disk has refilled. For steady-state behavior, `npm run
verify:conv-db:watch` passively samples the WAL/main sizes every 15s (flags
`--interval` / `--duration`, env `CONV_DB_WATCH_INTERVAL` /
`CONV_DB_WATCH_DURATION`) and reports write throughput, flush events, and the
peak WAL — a WAL that crosses the `wal_autocheckpoint` threshold with no
flush just means the app holds an open reader (deferred, healthy);
`verify:conv-db` flushes it on demand.

**Why the WAL grows** — confirmed Aug 2026: the app's own read transaction,
open around its writes, blocks the automatic PASSIVE checkpoint from
*resetting* the WAL file, so it ratchets up with use while the main DB stays a
stable ~48 MiB (frames still get copied in — the file is mostly dead space).
`npm run maintain:conv-db` is the periodic shrinker: when the `-wal` file
exceeds 2 MiB (override `CONV_DB_MAINTAIN_THRESHOLD`) it runs a TRUNCATE
checkpoint with a busy-retry loop (the read transaction blocks only
momentarily), so an idle moment reclaims the space. Schedule it every 10
minutes with `npm run conv-db:schedule install` (or `cron` for the crontab
line — launchd is TCC-blocked from scripts under `~/Documents`, see the
installer's note).

## 5. Go-live checklist (order matters)

1. **Firebase console** (`portfolio-app-freebuff2`):
   - Email/Password **and** Google providers enabled (Authentication → Sign-in method).
   - **Google sign-in uses a classic web OAuth client** (`{projectNumber}-{hash}.apps.googleusercontent.com` + `GOCSPX-…` secret) wired into the `google.com` IdP record via `GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node scripts/wire-google-client.mjs`. `gcloud iam oauth-clients` (Workforce) is rejected by Google's consumer OAuth endpoint — never use it.
   - Authorized domains include `portfolio-app-freebuff.vercel.app` + every preview URL.
2. **Vercel** — all env vars from §2 set on **Production** (and the GitHub secrets from §3).
3. **Rules** — `npx firebase deploy --only firestore:rules --project portfolio-app-freebuff2`.
4. **Push to `main`** — Vercel auto-deploys; the pre-push hook runs the local gates; CI runs the post-deploy gates.
5. **Run the full verify suite** against the production URL (§4). All sixteen gates must pass.
6. **Manual smoke** — sign in on the production URL with email/password, then Google; open Command Center; click AI Explain and confirm the briefing card renders with the `DeepSeek Chat` badge.

## 6. What was verified at go-live (2026-08-06)

- All four verify gates **PASS** against `portfolio-app-freebuff.vercel.app`
  (cron-reports, auth-domains, prod-signin incl. `[3b]` IdP checks, google-idp).
- CI for `fcdb059` (push run `31059206686`) and its Preview gate
  (`31059245823`) both **success**.
- Google popup opens the **real Google sign-in page** (classic client
  `952213217375-k4im9t45ebe…` wired into the IdP record).
- Email/password sign-in works end to end; Firestore write/read sync proven
  under a signed-in account against `portfolio-app-freebuff2`.
- Full test suite 336/336, typecheck clean.

## 7. Handoff notes / known caveats

- **Data starts fresh** on `portfolio-app-freebuff2` — first real users sign
  in to an empty (but working) Firestore. This was the deliberate migration
  decision.
- **Local dev runs in demo mode** unless the six Firebase vars are copied into
  `.env.local`; AI still works locally via `OPENROUTER_API_KEY` from
  `.env.local`.
- **Chrome on this Mac** was the flaky component (crashes; hardware
  acceleration disabled; `scripts/chrome-revive.sh` + a launchd watchdog
  `com.freebuff.chrome-watch.plist` installed). Dev-machine only — production
  is server-rendered on Vercel.
- **`CRON_SECRET` rotation** must update `.env.local`, Vercel, and the GitHub
  secret together (README documents the exact sed/vercel commands). Drift
  shows up as a `401` in the cron-reports gate.
- Migration history: `docs/migrations/dedicated-firebase-project.md` (old
  project references are historical, marked COMPLETE).
