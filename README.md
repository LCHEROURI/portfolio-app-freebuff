<div align="center">

# 🍳 App Portfolio Command Center

**One dashboard to run every AI-built version of your app idea.**

[![Live app](https://img.shields.io/badge/Live%20app-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://portfolio-app-freebuff.vercel.app)
[![CI](https://img.shields.io/github/actions/workflow/status/LCHEROURI/portfolio-app-freebuff/ci.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=CI)](https://github.com/LCHEROURI/portfolio-app-freebuff/actions/workflows/ci.yml)
[![Next.js](https://img.shields.io/badge/Next.js%2014-black?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com)
[![Tailwind](https://img.shields.io/badge/Tailwind%20CSS-38BDF8?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

**[Live app →](https://portfolio-app-freebuff.vercel.app)** · Real Firebase Auth — sign in with email/password or Google to see your command center.

</div>

---

## What it is

A solo developer doesn't build one app — they build the **same idea many times**,
once per AI model and platform: Gemini, DeepSeek, Lovable, Replit, Kimi K3,
Claude, Cursor, Codex, ChatGPT, Google AI Studio, Anti-Gravity, FreeBuff…

**App Portfolio Command Center** turns that chaos into a single, ranked,
actionable dashboard. Each business concept is a **Project**; each AI build of
it is a **ProjectVersion**. Repositories, deployments, tasks, model
evaluations, automated alerts, and daily/weekly reports all live in one
desktop-first view.

## Screenshots

The same screens in light and dark — the sidebar's connection-status widget
(per-var console links + copy buttons) is visible on every route. Captured
from a demo build (`NEXT_PUBLIC_DEMO_OVERRIDE=1`, see below) so the shots show
the app's screens without the sign-in gate; the live production URL
(`portfolio-app-freebuff.vercel.app`) is **Firebase-live** and starts at the
auth gate.

| Route | Light | Dark |
| :--- | :---: | :---: |
| **Command Center** | ![Command Center light](screenshots/command-center.png) | ![Command Center dark](screenshots/command-center-dark.png) |
| **Projects** | ![Projects light](screenshots/projects.png) | ![Projects dark](screenshots/projects-dark.png) |
| **Versions** | ![Versions light](screenshots/versions.png) | ![Versions dark](screenshots/versions-dark.png) |
| **Deployments** | ![Deployments light](screenshots/deployments.png) | ![Deployments dark](screenshots/deployments-dark.png) |
| **Repositories** | ![Repositories light](screenshots/repositories.png) | ![Repositories dark](screenshots/repositories-dark.png) |
| **Model Comparison** | ![Model comparison light](screenshots/model-comparison.png) | ![Model comparison dark](screenshots/model-comparison-dark.png) |
| **Reports** | ![Reports light](screenshots/reports.png) | ![Reports dark](screenshots/reports-dark.png) |
| **Integrations** | ![Integrations light](screenshots/integrations.png) | ![Integrations dark](screenshots/integrations-dark.png) |
| **Settings** | ![Settings light](screenshots/settings.png) | ![Settings dark](screenshots/settings-dark.png) |

> Try either theme on the live site: `?theme=light` / `?theme=dark` — e.g.
> `https://portfolio-app-freebuff.vercel.app/command-center?theme=dark` (the
> site is Firebase-live, so the first screen you meet is the sign-in gate)
>
> Regenerate the whole gallery whenever the UI changes with one command
> (targets the production URL by default, falls back to `localhost`):
> `npm run capture:screenshots`. The committed PNGs were captured from a
> **demo build** (`NEXT_PUBLIC_DEMO_OVERRIDE=1`) so the cells show the app
> without the sign-in gate; now that production is Firebase-live, regenerate
> against a demo source (`--url <demo-deploy>` or localhost in demo mode) or
> the cells will show the auth gate. Pass `--diff` to only rewrite PNGs whose
> pixels actually changed (trivial re-runs leave the git tree clean). Every run
> also refreshes **`docs/screenshots.html`** — a browsable contact sheet with
> the light/dark pairs side by side, for local viewing without the README.
>
> **CI keeps it honest** — `.github/workflows/gallery.yml` runs on every pull
> request: it deploys a Vercel **preview** of your branch, captures all 18 cells
> from that URL (not the shared production build), and **fails the check if any
> cell renders the auth gate or skips the app shell**. Screenshots are uploaded
> as a `gallery-screenshots` artifact for review. Required repo secrets:
> `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (from `vercel link`), and
> `VERCEL_PROTECTION_BYPASS` (the project's Deployment Protection bypass secret,
> sent as `x-vercel-protection-bypass` so the SSO wall doesn't block capture).
> The job auto-skips for fork PRs, which can't access secrets.

## Why it's a portfolio piece

- **A real engine, not a mockup** — the 8-tier priority queue, all **14
  automation rules**, "Today's Top Three", and daily/weekly report builders are
  implemented and running (`lib/engine.ts`).
- **Data-backed model selection** — every version is scored across 10 weighted
  axes (UI, features, code quality, stability, performance, maintainability,
  speed, cost, mobile, accessibility) so "which build won?" has an answer.
- **Production-ready data layer** — typed, user-isolated Firestore with real
  Authentication (email/password + Google), a `firestore.rules` security model,
  and a one-click **migration path** from the localStorage demo mode into a
  real account.
- **Ships with a local companion** — `scripts/repo-scanner.mjs` reads your git
  state locally and POSTs metadata (never source) to the scanner API, so repos
  show up in the dashboard.
- **Runs out of the box locally** — seeded with 6 realistic demo projects; no
  Firebase config required to explore every screen on a local dev server. The
  **deployed production URL runs Firebase-live** (sign-in gate + real
  Firestore under your account), never demo mode.

## Stack

- **Frontend:** Next.js 14 (App Router), React 18, TypeScript
- **Styling:** Tailwind CSS, Lucide icons, light/dark/system themes (`?theme=` URL override)
- **Data:** Firebase Auth + Cloud Firestore (typed, user-isolated, `firestore.rules`) with a fully functional **local demo fallback** (localStorage) — local demo data can be **imported into a real account** on first sign-in
- **Automation:** 14-rule engine + priority queue + "Today's Top Three", fired by a Vercel Cron (`/api/cron/reports`) that composes daily/weekly reports against live data
- **Integrations:** GitHub REST, Vercel API, Google Calendar, Gemini AI summaries

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Open http://localhost:3000 → redirected to `/command-center`. The app seeds 6
demo projects (Classic Chef Video Guide, Weeknight Meal Planner, Restaurant
Social Media Manager, Restaurant 86-to-0 Board, Menu Competitor Analyzer,
Takeout Voice 2) and persists changes to localStorage in **local demo mode**.
This is the no-config fallback for local development and forks. The **deployed
production URL does not run in demo mode**: it is Firebase-live, shows a
sign-in gate, and reads/writes real Firestore under your account.

### Opt into Firebase (real Auth + Firestore)

Create a `.env.local` with your Firebase web-app config values:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=…
NEXT_PUBLIC_FIREBASE_PROJECT_ID=…
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=…
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=…
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=…
NEXT_PUBLIC_FIREBASE_APP_ID=…
```

When these are present the app switches to real Authentication + Firestore:

- A **sign-in gate** appears (`components/auth/AuthGate.tsx`) — email/password
  or Google (popup). Authentication lives in `lib/auth.tsx`.
- Every read/write is scoped by `userId` via `lib/firestore.ts`, and
  `firestore.rules` enforces the same per-user isolation server-side.
- On first sign-in the app offers to **import your local demo data** into the
  account (`migrateLocalDemoToFirestore` in `lib/firestore.ts`) — projects,
  versions, repos, deployments, tasks, evaluations, and activity are re-keyed
  to your uid and written to Firestore.
- Sign out from the sidebar footer or Settings → Account.

Deploy the rules with:

```bash
npx firebase deploy --only firestore:rules
```

**Google sign-in (popup) needs a classic web OAuth client.** Email/password
works out of the box, but the Google provider requires a *classic* web OAuth
client (`{projectNumber}-{hash}.apps.googleusercontent.com` + a `GOCSPX-…`
secret) registered in the Identity Platform `defaultSupportedIdpConfigs`
record. The Firebase console's Google toggle normally auto-creates this; if it
silently fails (the console shows Enabled but the API 404s), create the client
manually in the GCP console (Google Auth Platform → Clients → Create Client →
**Web application**, with `https://<auth-domain>/__/auth/handler` as an
authorized redirect URI) and wire it in with the one-shot script:

```bash
GOOGLE_CLIENT_ID=<projectNumber>-<hash>.apps.googleusercontent.com \
GOOGLE_CLIENT_SECRET=GOCSPX-... \
node scripts/wire-google-client.mjs
```

The script PATCHes the `google.com` IdP record via the admin API and verifies
accounts.google.com recognizes the client. Do **not** use
`gcloud iam oauth-clients` for this — it creates Workforce/IAP clients with
UUID-style ids that Google's consumer OAuth endpoint rejects with "The OAuth
client was not found". The `isClassicWebClientId` / `isClassicClientSecret`
format guards (tested in `scripts/wire-google-client.test.ts`) reject exactly
that failure mode.

In **local Demo Mode** (no env vars) everything still works: seeded data
persists to localStorage and the app never asks for credentials. This is the
fallback for local dev / forks — the deployed **Production** environment has
all six Firebase vars set and runs verified Firebase-live, not demo mode.

### 🌐 Production environment on Vercel

As of the current deploy, the Vercel project's **Production** environment runs
in **Firebase mode** — every live API route requires a cryptographically
verified Firebase ID token. The environment carries these variables (names only
— values are encrypted in Vercel and never committed):

```bash
# Firebase identity + data (flips every API route from demo to verified auth)
NEXT_PUBLIC_FIREBASE_API_KEY=…
NEXT_PUBLIC_FIREBASE_PROJECT_ID=…
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=…
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=…
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=…
NEXT_PUBLIC_FIREBASE_APP_ID=…

# OpenRouter (activates AI features: report summaries, winner picks, top-three briefings)
OPENROUTER_API_KEY=…
OPENROUTER_MODEL=…   # optional; the per-user Settings picker overrides it in the UI
```

`NEXT_PUBLIC_DEMO_OVERRIDE` is deliberately **not** set in Production — it was
removed so the live API routes stop trusting the spoofable `x-app-user` header.
Set it only in a separate demo deployment if you want a public no-sign-up
build (forces demo mode even with the Firebase vars present).

**Why this list matters:** these six Firebase vars are the on/off switch for
the whole live-data layer. When `NEXT_PUBLIC_FIREBASE_PROJECT_ID` is set,
every live API route (`/api/tasks`, `/api/repos`, `/api/deployments`, all
`/api/ai/*`, …) resolves the acting user from a **cryptographically verified
Firebase ID token** and ignores the legacy `x-app-user` header. If a future
deploy silently drops one of these six, the app falls back to **demo mode**:
the auth gate disappears, data lives in per-browser localStorage, and the API
routes trust the spoofable `x-app-user` header again. Keep the full set on
Vercel in every environment that should behave as a real account.

**Demo-mode identity caveat:** a local dev server runs in demo mode unless you
copy the same six Firebase vars into `.env.local`. When they are present the
preview is Firebase mode: the auth gate appears, and the API routes accept
`Authorization: Bearer <idToken>` (verified RS256 against Google's public
certs). AI-generated content on `localhost` still works because
`OPENROUTER_API_KEY` is read from `.env.local`. A fresh fork or a redeploy
missing `OPENROUTER_API_KEY` degrades gracefully: AI surfaces fall back to the
deterministic rule-based text (no crash, no missing sections). To verify the
AI layer is live in production, open the **Integrations** page — the status
panel reports which vars are set and which endpoints respond.

### 🔌 Live integrations — Firestore · GitHub · Vercel

The Command Center ships with a **live-data layer** that replaces demo
placeholder data with your real services. There is **no separate database**:
the app's single data store is **Firestore** — the client persists projects,
versions, evaluations, tasks, and activity through the Firebase SDK, and the
automation cron reads the *same* documents server-side via a service account.
GitHub and Vercel feeds are toggled by a `NEXT_PUBLIC_LIVE_*` flag plus a
matching server-side credential; if a credential is missing the app falls back
to local demo data, so every screen stays usable.

Every integration is activated by an exact set of env vars — the table below is
the complete map. The `NEXT_PUBLIC_*` flags are **inlined at build time**, so
flipping one requires a redeploy; the server-side vars are read at runtime and
only need an env change + redeploy to take effect.

| Source | Feeds | Activating env (build-time flags + server secrets) |
| --- | --- | --- |
| **Firebase identity** | The on/off switch for the whole live-data layer: sign-in gate + signed-in user + verified ID-token auth on every API route | `NEXT_PUBLIC_FIREBASE_API_KEY` + `NEXT_PUBLIC_FIREBASE_PROJECT_ID` + `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` + `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` + `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` + `NEXT_PUBLIC_FIREBASE_APP_ID` (all six — missing any one reverts to demo mode) |
| **Firestore** | `Projects`/`Versions`/`Tasks`/`Activity` — the app's single data store; the cron reads the same docs the client writes | (always on with Firebase identity) · `FIREBASE_SERVICE_ACCOUNT` (cron server reads), `NEXT_PUBLIC_FIREBASE_PROJECT_ID` |
| **GitHub** | `Repositories` — branches, latest commit, PRs, issues, workflow status | flag `NEXT_PUBLIC_LIVE_REPOS=1` · `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPOS` |
| **Vercel** | `Deployments` — latest deploy per project + live health checks (HTTP status + response time) | flag `NEXT_PUBLIC_LIVE_DEPLOYMENTS=1` · `VERCEL_TOKEN`, `VERCEL_TEAM_ID` |
| **OpenRouter (AI)** | Executive summaries, "Today's Top Three" narration, winner recommendations (AI Explain) | flag `NEXT_PUBLIC_ENABLE_AI_BRIEFINGS=1` (auto-fires the briefing on load) · `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |
| **Automation Engine** | Scheduled daily/weekly report generation (in-app Reports page) | (no build-time flag) · `CRON_SECRET`, `REPORT_OWNER_ID` (+ optional `REPORT_WEEKLY_DAY`, `REPORT_STALE_DAYS`) |

**Setup (full detail in `.env.example`):**

1. **Firestore** — no schema to push. The client writes through the Firebase
   SDK; for the automation cron, generate a service account JSON (Console →
   Project settings → Service accounts) with Firestore read access
   (`roles/datastore.user`) and set `FIREBASE_SERVICE_ACCOUNT`.
2. **GitHub** — create a fine-grained PAT (repo read). Owner defaults to
   `LCHEROURI`; the repo list defaults to your 7 active repos and is
   overridable via `GITHUB_REPOS`.
3. **Vercel** — create an API token (Account → Tokens). Projects default to
   `GITHUB_REPOS` (or set `VERCEL_PROJECTS`).
4. Flip the matching `NEXT_PUBLIC_LIVE_*` flag to `1` and redeploy.

**Connection status panel** — the **Integrations** page live-polls `/api/status`
(every 30s + manual refresh) and shows, per integration: exactly which env
vars are set (✓/✗, booleans only — values are never exposed) and a live
endpoint ping with HTTP status + latency (Firestore, GitHub
`rate_limit`, Vercel `v2/user`, Firebase projects API, and the automation
engine). Pings are cached server-side for 2 minutes (successful responses
only — failures retry immediately), so polling never hammers provider APIs;
the Refresh button bypasses the cache with `?refresh=1`. Both surfaces also
poll *immediately* when the window or tab regains focus, so setup feedback
shows up the moment you return after pasting env lines and redeploying. Each
integration card carries an **"Open Vercel project env settings"** link that
deep-links straight to the project's Environment Variables page (overridable
via `NEXT_PUBLIC_VERCEL_TEAM_SLUG` / `NEXT_PUBLIC_VERCEL_PROJECT_SLUG` for
forks). The same deep-link is one click from anywhere a missing integration is
surfaced: the **Command Center** landing banner (when no live source is
connected), the **sidebar connection-status widget** (an inline row when any
integration isn't healthy, plus the exact URL in its tooltip when nothing is
connected), the **auth gate** first-run screen, the **Settings** demo-mode
note, and each setup checklist. Same Firebase-token auth as every other live
route.

> **Auth model:** every live API route is owner-scoped by a **cryptographically
> verified Firebase ID token** (`Authorization: Bearer <idToken>`, RS256-verified
> against Google's public certs — see `lib/server/firebase-token.ts`). The old
> `x-app-user` header is ignored server-side whenever Firebase is configured, so
> it can no longer be spoofed to read or write another user's rows. In demo mode
> (no Firebase env vars) the header is still used — there is no token issuer and
> the data is per-browser local.

> **Local git state:** unpushed commits and uncommitted changes exist only on
> your machine, so the GitHub API can't see them. The **repo scanner CLI**
> (`npm run scanner`) reports those and the store overlays them onto the live
> GitHub feed (see `mergeScannerOverlay` in `lib/store.tsx`).

### 🤖 Automation Engine — scheduled daily/weekly report generation

The 14 rules aren't just a dashboard widget — a **Vercel Cron job**
(`vercel.json` → `/api/cron/reports`) evaluates them against the **live data**
(Firestore tasks/projects/versions/evaluations via the service account, live
GitHub repos, Vercel/Firebase deployments with health checks) and composes a
report for the in-app **Reports** page (nothing is emailed):

- **Daily (07:00 UTC):** attention items, overdue + due-today + completed-
yesterday tasks, failed deployments, unpushed commits, priority queue, and
"Today's Top Three" actions.
- **Weekly (07:00 UTC every Monday, or `REPORT_WEEKLY_DAY`):** projects advanced,
deployment health, model performance breakdown, and winner recommendations.

**Setup:**

```bash
# 1. Add to Vercel → Project → Settings → Environment Variables:
CRON_SECRET=<long-random-string>   # Vercel Cron sends this as the auth header

# 2. Optional: REPORT_OWNER_ID (default demo-user), REPORT_WEEKLY_DAY (1=Mon),
#    REPORT_STALE_DAYS (7)

# 3. Redeploy — Vercel registers the cron from vercel.json automatically.
```

> **No email.** The cron evaluates the 14 automation rules and composes the
> report bodies for the in-app Reports page and the verification suite
> (`?previewBody=1`, `format=text`) — it never sends email, so no
> sender keys, inbox, or delivery domain is needed.

The route returns `401` without the `Authorization: Bearer <CRON_SECRET>`
header, so it can't be triggered by the public. Test a run manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://portfolio-app-freebuff.vercel.app/api/cron/reports?kind=daily"
```

It skips composing while no live sources are wired (nothing to report), and each
report is also visible in the Vercel cron invocation logs.

**Verifying the composed bodies without an inbox:** the route accepts a dev-only
`?previewBody=1` flag (still CRON_SECRET-authed) that includes each composed
report body — plus the structured top-three narration — in the JSON response.
Add `&format=text` to get a **plain-text report preview**: the composed body is
served as `text/plain` (nothing is sent), so the exact text can be piped into
a file or viewer without waiting for the scheduled cron:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://portfolio-app-freebuff.vercel.app/api/cron/reports?kind=daily&previewBody=1&format=text"
```

The packaged smoke test asserts the auth gate, the friendly model heading, and
the raw-id footer for both daily and weekly bodies:

```bash
npm run verify:cron-reports               # against the production URL
node scripts/verify-cron-reports.mjs \
  --base http://localhost:3000 \
  --secret "$CRON_SECRET"                 # against a local dev server
```

It reads `CRON_SECRET` from `--secret`, then the `CRON_SECRET` env var, then
`.env.local`, and exits nonzero on any failed assertion.

**Post-deploy verification suite — every push proves the live app.** Three
packaged smoke tests run against the deployed URL after each push to `main`
(see `.github/workflows/ci.yml`); each reads its secrets from env (then
`.env.local`) and exits nonzero on any failed assertion:

| Script | What it proves | Required GitHub secret |
| --- | --- | --- |
| `npm run verify:cron-reports` | Deployed `/api/cron/reports` 401s without auth; daily + weekly report bodies carry the friendly `(DeepSeek Chat)` heading and the raw-id `Model:` footer | `CRON_SECRET` |
| `npm run verify:firestore-rules` | Merged rules on the shared project: portfolio write/read under the user's uid, cross-user denied, meal-planner owner grants + stranger denials (mints + deletes a throwaway user) | `FIREBASE_WEB_API_KEY` |
| `npm run verify:auth-domains` | Deployed `/api/status?project=<domain>` reports `authDomains.ok` for the shipping domain (defaults to the production URL; pass `--domain <preview-url>` to validate a preview before it ships) | `FIREBASE_WEB_API_KEY` |

Set `CRON_SECRET` and `FIREBASE_WEB_API_KEY` in **GitHub → Settings → Secrets
→ Actions** (and the same values in Vercel's env for the deployed app). The
`verify-deployed` CI job runs cron-reports + Firestore rules after every push;
the `verify-auth-domains` job fails the run when the domain is not in the
project's Firebase **Authorized domains** list; and
`.github/workflows/preview-gate.yml` runs the same check against every Vercel
**preview** URL via the `deployment_status` webhook. The merged
`firestore.rules` itself is guarded by `lib/firestoreRules.test.ts`, which
asserts every portfolio + meal-planner collection and its field-level
constraints survive future edits.

Local equivalents (against `localhost`):

```bash
node scripts/verify-cron-reports.mjs --base http://localhost:3000 --secret "$CRON_SECRET"
node scripts/verify-firestore-rules.mjs
node scripts/verify-auth-domains.mjs --app http://localhost:3000 --domain localhost
```

The cron writes a `report_generated` activity entry (kind + message) into the
Firestore `activity` collection when the service account is configured, so the
`/activity` feed shows when the automation engine generated reports.

**Rotating `CRON_SECRET`** (do this whenever it may have leaked, or to keep the
local `.env.local` and the Vercel/GitHub values in lockstep):

```bash
# 1. Generate a fresh value and update it everywhere the old one lives. Use
#    sed (not perl) so the shell expands the value before it touches the file:
NEW_SECRET="$(openssl rand -hex 32)"
sed -i.bak "s|^CRON_SECRET=.*|CRON_SECRET=${NEW_SECRET}|" .env.local && rm .env.local.bak
printf '%s' "$NEW_SECRET" | vercel env rm CRON_SECRET production -y >/dev/null 2>&1 || true
printf '%s' "$NEW_SECRET" | vercel env add CRON_SECRET production

# 2. GitHub Actions: update the CRON_SECRET secret (Settings → Secrets → Actions)
#    so the verify-deployed-cron job keeps running.

# 3. Redeploy — Vercel Cron reads the new value from the fresh deployment.
vercel --prod
```

**Keep the two in sync:** the cron only authenticates when the header matches
the `CRON_SECRET` in the deployed environment, and the smoke test only passes
when that value matches the one in `.env.local`. If a `401` shows up in the
cron logs or the CI job, re-run the rotation steps above in both places.

**Rotating `VERCEL_TOKEN`** (do this whenever it expires, is revoked, or the
pre-push hook / CI reports `VERCEL_TOKEN is invalid or revoked`):

```bash
# 1. Generate a fresh token at https://vercel.com/account/tokens, then update
#    it in BOTH places at once — the two must never drift:
NEW_TOKEN="vca_..."   # paste the fresh value
sed -i.bak "s|^VERCEL_TOKEN=.*|VERCEL_TOKEN=${NEW_TOKEN}|" .env.local && rm .env.local.bak
printf '%s' "$NEW_TOKEN" | gh secret set VERCEL_TOKEN --repo LCHEROURI/portfolio-app-freebuff

# 2. Optional but recommended: refresh the Vercel CLI store too, so local
#    `vercel` deploys don't keep using a revoked credential. The CLI keeps its
#    config at ~/Library/Application Support/com.vercel.cli/auth.json (not
#    ~/.vercel/):
printf '{"token":"%s"}\n' "$NEW_TOKEN" > "$HOME/Library/Application Support/com.vercel.cli/auth.json"
chmod 600 "$HOME/Library/Application Support/com.vercel.cli/auth.json"
```

**Keep the two in sync:** the pre-push hook and the deployed-hash/`gallery.yml`
CI jobs read `VERCEL_TOKEN` from `.env.local` and the GitHub repo secret
respectively — if only one is rotated, the local push gate passes while the CI
gate fails (or vice versa) with the `invalid or revoked` message. Rotate both
together and verify with `node scripts/verify-deployed-hash.mjs --url
https://portfolio-app-freebuff.vercel.app`.

**Even a no-expiration token can die.** Vercel revokes tokens when you create a
new one with the "invalidate existing" option, or when account security
settings change — so treat every token as rotatable, and set a **~90-day
calendar reminder** to re-run `npm run verify:token-health` (see below). That
packaged check reads the stored `VERCEL_TOKEN`, calls `GET /v2/user/tokens`,
and reports the active token's **name + expiry** (or "no expiration") — and
when Vercel flags the credential as revoked (`invalidToken: true`) it exits 2
with the same paste-a-fresh-token message as the deployed-hash gate. It's wired
into the pre-push hook as its own gate, so a revoked or expiring token is
caught before it silently breaks a deploy or CI run:

```bash
npm run verify:token-health          # reports the active token's name + expiry
```

### Local Repository Scanner companion

```bash
node scripts/repo-scanner.mjs --path ~/dev/my-app --api http://localhost:3000/api/scanner
```

The CLI reads `git status --porcelain`, `git remote -v`, `git branch
--show-current`, `git log -1` and `git rev-list --left-right --count`, then
POSTs **metadata only** (never source code) to the Command Center API.

Sweep every local repo in one shot with the scan-all command, which runs the
scanner against each `.git` folder under a root (default `~/Documents`), prints
a summary table, and — with `--notify` — regenerates the daily report
immediately after a clean sweep so fresh local facts reach the in-app feed
without waiting for the scheduled run:

```bash
npm run scan:all                          # sweep ~/Documents → local API
npm run scan:all -- --root ~/dev          # custom root
npm run scan:all -- --notify              # also fire the daily cron report
node scripts/scan-all.mjs --api https://portfolio-app-freebuff.vercel.app/api/scanner \
  --token <pat> --notify                  # sweep into the deployed API
```

The scan-all command exits nonzero if any repo fails to ingest, so it can gate
CI or be chained (`data/` is gitignored — the per-repo facts land in
`data/scans.json`, the same file the cron snapshot overlays onto the live
GitHub feed).

#### Daily scheduled scan (launchd / cron)

To keep local facts fresh every morning **before** the 07:00 daily report,
install the launchd agent (or use its cron alternative) — it runs
`scan-all --notify` at **06:30 local time** by default, then seeds the
composed report into the in-app Reports feed via `seed-in-app-reports
--owner <REPORT_OWNER_ID>` (env var, else `.env.local`, else `demo-user`)
— and logs to `.freebuff/scan-all.log`:

```bash
npm run scan:schedule install      # write ~/Library/LaunchAgents plist + load
npm run scan:schedule status       # agent state + last log lines
npm run scan:schedule uninstall    # stop + remove the agent
npm run scan:schedule cron         # print the crontab alternative line
```

Override the run time with `SCAN_HOUR` / `SCAN_MINUTE` (e.g.
`SCAN_HOUR=5 SCAN_MINUTE=45 npm run scan:schedule install`), and point the
scheduled sweep at a non-default API via `SCAN_ALL_API` (see
`scripts/scan-all-scheduled.sh`). The **Settings → Local scan schedule** card
documents these commands and shows the last scan per repo (read from
`data/scans.json` via `GET /api/scans`) with the same fresh/stale badge the
Repositories page uses — so a missing or stale scan is visible right next to
the documented schedule.

### Chrome crash recovery

If Chrome stops opening (no window, no error, the icon just disappears), its
main process likely crashed and left stale Singleton lock files behind; Chrome
then thinks another instance is running and exits silently. One command revives
it — sweeps leftover headless instances from the capture/verify scripts, clears
the stale locks, and relaunches Chrome:

```bash
./scripts/chrome-revive.sh          # clean up + relaunch Chrome
./scripts/chrome-revive.sh --no-launch   # clean up only
```

The `.githooks/pre-push` hook runs it (timeboxed to 15s) before any verifier,
so a crashed Chrome is revived automatically on every push. Full incident
details in `docs/reviews/2026-08-05-chrome-crash.md`. Every script that spawns
headless Chrome (the gallery driver, the sign-in/matrix verifiers, the live
tour) also kills its own instance and drops its throwaway profile on exit and
on signals, so interrupted runs can never accumulate leftovers.

### Cloud Functions (optional)

```bash
cd functions
npm install
npm run serve   # emulator
npm run deploy
```

Scheduled functions: `runAutomation` (every 6h), `generateDailyReports` (daily
08:00 UTC), `generateWeeklyReports` (Monday 09:00 UTC). On-demand endpoints:
`/healthCheck`, `/runAutomationNow`, `/ingestScannerReport`.

## Modules

| Route | Purpose |
| --- | --- |
| `/command-center` | Metric cards, ranked priority queue, Today's Top Three, alerts, stale watch |
| `/projects` | Filterable portfolio (grid/table), project create/edit modal |
| `/projects/[id]` | Detail tabs: Overview, Versions, Tasks, Repos, Deployments, Evaluation, Activity |
| `/versions` | All builds across projects |
| `/today` | Top three, due today, overdue, reminders, recently completed |
| `/tasks` | Kanban board + list view |
| `/deployments` | Health + status of every environment |
| `/repositories` | Repo cards + scanner instructions |
| `/model-comparison` | Weighted score matrix + winner selection |
| `/reports` | Generate/save daily & weekly reports (preview-before-save + in-app save) |
| `/activity` | Event feed with kind filters |
| `/integrations` | GitHub / Vercel / Calendar / Gemini connection UI |
| `/gallery` | Every module's screenshot pair (light/dark) on the live site |
| `/settings` | Profile, report schedule, stale threshold, demo reset |

## Model Evaluation scoring

Overall = 0.15·UI + 0.20·Features + 0.15·Code + 0.15·Stability + 0.10·Perf +
0.10·Maint + 0.05·Speed + 0.05·Cost + 0.03·Mobile + 0.02·A11y (1–10 scale).

## Project layout

```
app/            Next.js App Router pages + API route (scanner ingest)
components/     Layout shell, auth gate, modals, UI kit
lib/            firebase.ts, auth.tsx, firestore.ts, seed.ts, engine.ts,
                store.tsx (React context), liveData.ts (live API facade),
                theme.tsx
app/api/        Live API routes: repos (GitHub), deployments (Vercel + health
                checks), scanner, cron/reports (automation engine)
lib/server/     github.ts, deployments.ts, firestoreAdmin.ts,
                reporting/ (data assembly)
lib/firestore.ts  Client Firestore store — the app's single data layer
types/          Full domain model + zod schemas + scoring
scripts/        repo-scanner.mjs (local CLI companion)
functions/      Firebase Cloud Functions (automation + scheduled reports)
firestore.rules Per-user Firestore security rules
screenshots/    Screenshots used in this README
```
