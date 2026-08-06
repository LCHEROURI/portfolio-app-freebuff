# 🚀 Launch checklist — go-live requirements & verified state

Everything a launch or handoff needs to know: the identity of the live
deployment, the env vars it depends on, and the exact verification gates that
prove it works. Written after the go-live pass on **2026-08-05/06** so the
next launch (or a new maintainer) doesn't re-derive any of it.

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

# Automation cron + email
CRON_SECRET                 # Vercel Cron auth header; keep in sync with .env.local
RESEND_API_KEY
REPORT_EMAIL
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

| Gate | What it proves |
| --- | --- |
| `npm run verify:token-health` | Stored `VERCEL_TOKEN` is alive: reads it (env → `.env.local` → CLI store), calls `GET /v2/user/tokens`, and reports the active token's name + expiry (or "no expiration"); a revoked token exits 2 with the paste-a-fresh-token guidance. Runs **first** in `verify:all` so a dead credential is caught in ~1s before any gate that depends on it |
| `npm run verify:vercel-env` | Vercel production env **matches** `.env.local`: pulls the decrypted values via `vercel env pull`, asserts every local key exists in Vercel prod with an identical value (report shows names + value lengths only, never the secrets), reports Vercel-only vars as informational, and classifies GitHub secrets — CI-only ones (e.g. `VERCEL_ORG_ID`) are expected, not drift, while a GitHub secret that `.env.local` has but Vercel prod lacks fails the gate. Exits 1 on drift, 2 on an invalid token. Requires `VERCEL_TOKEN` + the Vercel CLI; `gh` degrades to skip-not-fail |
| `npm run verify:resend` | Stored `RESEND_API_KEY` is **alive**: probes `GET /api-keys` with the key as a Bearer token (read-only — sends no email). HTTP 200 passes as a full-access key; the `restricted_api_key` 401 passes with a note (Resend's send-only permission is exactly what the Automation Engine needs); any other 400/401/403 exits 2 with paste-a-fresh-key guidance (same rc=2 contract as the Vercel token gates). Requires `RESEND_API_KEY` (env → `.env.local`) |
| `npm run verify:cron-email` | Deployed `/api/cron/reports` 401s without auth; daily + weekly email bodies carry the friendly `(DeepSeek Chat)` heading and raw-id `Model:` footer; weekly winner-recommendation section present |
| `npm run verify:firestore-rules` | Rules on `portfolio-app-freebuff2`: portfolio write/read under the user's uid, cross-user denied |
| `npm run verify:auth-domains` | `/api/status?project=<domain>` reports `authDomains.ok` for the shipping domain |
| `node scripts/verify-prod-signin.mjs` | AuthGate renders, email/password + Google buttons present, both IdPs enabled (admin API), sign-in releases into the Command Center, Firestore write/read sync proven; `[3b]` asserts the classic OAuth client |
| `node scripts/verify-google-idp.mjs` | `createAuthUri` resolves `google.com` with a classic web client id; admin API confirms the IdP record is enabled |
| `node scripts/verify-auth-domains.mjs` | same as `verify:auth-domains` with throwaway-user token |
| `npm run verify:deployed-hash -- --expect <sha>` | Production is actually serving the expected commit — the exact gate the `deployed-hash` CI workflow and pre-push hook run. Pass the commit you expect to be live (`git rev-parse origin/main` for the last pushed commit; `--check-local` compares against local HEAD instead) |
| `npm run verify:import-surface` | Static import-surface lint over `scripts/` + `lib/` + `app/` (TS-compiler-AST scan): no re-exported imports and no unused imports. No secrets, no network — also wired into `npm run lint`, the pre-push hook (gate 0.6), and CI's lint step |

Run **all eleven in one command** with `npm run verify:all` — it preflights the
drift guard above, runs every gate sequentially against the production URL
(or `--app <url>` to target a preview/local server), dedupes the two
auth-domains rows (they share one script), and prints a summary table,
exiting nonzero on any failure. `--only a,b` / `--skip a,b` narrow a run;
`--expect <sha>` forwards a deployed-hash assertion into the runner.

CI runs the cron-email + firestore-rules + auth-domains gates after every push
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

**Known transient:** the auth-domains gate can briefly FAIL right after a
deploy because the deployed `/api/status` serves a 2-minute cached
`getProjectConfig` snapshot. Re-run it; it passes with `refresh=1`.

**Known transient (GitHub Actions outage):** a gate stuck **queued** for many
minutes, or one failing at the **Set up job** step with `Service Unavailable`
/ `Failed to resolve action download info`, means GitHub's action-download
service is degraded — not your code. No redeploy is needed: wait for the
outage to clear and re-run the run (`gh run rerun <id>`); the deployed app is
unaffected.

## 5. Go-live checklist (order matters)

1. **Firebase console** (`portfolio-app-freebuff2`):
   - Email/Password **and** Google providers enabled (Authentication → Sign-in method).
   - **Google sign-in uses a classic web OAuth client** (`{projectNumber}-{hash}.apps.googleusercontent.com` + `GOCSPX-…` secret) wired into the `google.com` IdP record via `GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node scripts/wire-google-client.mjs`. `gcloud iam oauth-clients` (Workforce) is rejected by Google's consumer OAuth endpoint — never use it.
   - Authorized domains include `portfolio-app-freebuff.vercel.app` + every preview URL.
2. **Vercel** — all env vars from §2 set on **Production** (and the GitHub secrets from §3).
3. **Rules** — `npx firebase deploy --only firestore:rules --project portfolio-app-freebuff2`.
4. **Push to `main`** — Vercel auto-deploys; the pre-push hook runs the local gates; CI runs the post-deploy gates.
5. **Run the full verify suite** against the production URL (§4). All eleven gates must pass.
6. **Manual smoke** — sign in on the production URL with email/password, then Google; open Command Center; click AI Explain and confirm the briefing card renders with the `DeepSeek Chat` badge.

## 6. What was verified at go-live (2026-08-06)

- All four verify gates **PASS** against `portfolio-app-freebuff.vercel.app`
  (cron-email, auth-domains, prod-signin incl. `[3b]` IdP checks, google-idp).
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
  shows up as a `401` in the cron-email gate.
- Migration history: `docs/migrations/dedicated-firebase-project.md` (old
  project references are historical, marked COMPLETE).
