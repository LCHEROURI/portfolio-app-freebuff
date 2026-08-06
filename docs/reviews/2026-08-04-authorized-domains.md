# Postmortem, authorized-domains sign-in blocker, 2026-08-04

**Severity**: High (all sign-in blocked on the production domain)
**Status**: Resolved, deployed, and proven end to end
**Symptoms**: `Error (auth/unauthorized-domain)` on https://portfolio-app-freebuff.vercel.app — the AuthGate refused every sign-in and the Integrations panel's authorized-domains check reported `ok: false` for the production origin.

## What happened

The app runs Firebase Auth on the shared `meal-planner-lcherouri` project. The project's `authorizedDomains` list was the meal-planner's original set (localhost, the firebaseapp.com / web.app hosts, and three older Vercel apps). `portfolio-app-freebuff.vercel.app` was never added, so Identity Platform rejected every sign-in from that origin with `auth/unauthorized-domain`.

> **Update (Aug 2026):** this shared-project arrangement no longer exists. The
> app moved onto its own dedicated Firebase project,
> `portfolio-app-freebuff2`, with a portfolio-only ruleset (see
> `docs/migrations/dedicated-firebase-project.md`). The migration is
> **complete and verified**: all four gates (`verify:cron-email`,
> `verify:auth-domains`, `verify-prod-signin`, `verify:google-idp`) PASS
> against `portfolio-app-freebuff2`. The shared `meal-planner-lcherouri`
> list below is historical context only.

The blocker surfaced in three places that all read the same list:

- The AuthGate's live sign-in attempt (the visible symptom).
- `scripts/verify-auth-domains.mjs`, which calls the deployed app's `/api/status?project=<domain>` and asserts `authDomains.ok`.
- The CI gates: the `verify-auth-domains` job on every push and the `preview-gate.yml` job on every Vercel `deployment_status` event.

Console fixes kept failing to land (the console edit was applied to a different Firebase project under the same account), so the fix was applied programmatically instead.

## The fix

`.freebuff/add-auth-domains.py` uses the Firebase CLI's stored OAuth token (which carries the `firebase` and `cloud-platform` scopes) to call the Identity Platform admin v2 API:

1. `GET https://identitytoolkit.googleapis.com/admin/v2/projects/{project}/config` to read the current list.
2. `PATCH ...?updateMask=authorizedDomains` with the existing list plus the new domain appended (purely additive, existing entries preserved verbatim).
3. Re-read through the **public** `getProjectConfig` endpoint (`/v1/projects?key=<web-api-key>`) — the same one the app's `/api/status` check reads — to confirm the domain is live.

The exact production domain was added first (`portfolio-app-freebuff.vercel.app`). Later, exact deployment-preview URLs were added one at a time with the same helper so preview sign-in works on those specific hosts.

## Why wildcards are rejected

Firebase's validator rejects wildcard entries in `authorizedDomains` with `INVALID_AUTHORIZED_DOMAIN`. A pattern like `portfolio-app-freebuff2-*.vercel.app` is not accepted; only exact hostnames. Each Vercel preview gets a unique hostname, so a preview must either be added by its exact URL or sign-in there stays blocked (the reasonable default for throwaway deploys).

## How the gate is proven

`scripts/verify-auth-domains.mjs` mints a throwaway Identity Toolkit user, calls the deployed `/api/status?project=<target-domain>`, and asserts the Firebase `authDomains.ok` flag for that origin. It exits nonzero otherwise. The same script drives CI: `verify-auth-domains` on push (production domain) and `preview-gate.yml` on `deployment_status` (the exact deployment URL Vercel just handed out).

End-to-end proof after the fix, all PASS:

- `npm run verify:auth-domains` against production: `portfolio-app-freebuff.vercel.app` is in the authorized list.
- `scripts/verify-prod-signin.mjs`: a real headless-Chrome sign-in from the production origin — AuthGate renders, credentials are typed and submitted, the gate releases into the Command Center shell, and a Firestore probe document is written and read back under the signed-in account (rules allow owner reads).
- Exact preview deployment URLs added via the helper and verified through the public endpoint.

## Prevention

- The CI gates stay in place: every push re-proves the production domain is authorized, and every Vercel deployment re-proves the exact URL it shipped.
- Adding a domain is now a one-line idempotent helper call instead of a manual console step, so future projects can be unblocked without hunting through the console.

## Token refresh: the 401 and how the helper self-heals

Midway through adding preview URLs, the helper started failing with a 401 on the admin API. Two bugs caused it:

1. **Milliseconds vs seconds.** The Firebase CLI stores `expires_at` in milliseconds, but the helper compared it against `time.time()` (seconds). The comparison always looked fresh, so the helper never refreshed and kept sending the expired access token, which the admin API rejects with 401. Fix: compare `expires_at` against `time.time() * 1000`.
2. **Missing client secret.** The refresh call sent `client_secret: ''`. Google's token endpoint rejects that with `invalid_request: client_secret is missing`. The real secret is baked into firebase-tools (`lib/api.js` -> `clientSecret()`); the helper now uses it.

With both fixes, the helper refreshes the OAuth token, persists it back into `~/.config/configstore/firebase-tools.json`, and continues. A full interactive re-login (`firebase login`) is only needed if the refresh token itself is ever revoked; until then the helper self-heals on every run. If a future run prints `TOKEN_FAIL`, refresh the token once with `firebase login --no-localhost` (paste the code back) or delete the stale entry in the configstore and log in again.

## Gotcha: fresh deployment URLs sit behind Vercel's SSO wall

Validating a freshly deployed URL from CI hit a second wall: Vercel's deployment protection 302-redirects the raw deployment URL to `vercel.com/sso-api`, so a script following redirects lands on an HTML page (HTTP 200, no JSON) and reports "no firebase.authDomains" instead of the real domain verdict. The gallery capture workflow already solved this with the `VERCEL_PROTECTION_BYPASS` secret sent as an `x-vercel-protection-bypass` header; the authorized-domains gate now uses the same header when that secret is set (`scripts/verify-auth-domains.mjs` + `.github/workflows/preview-gate.yml`). Without the secret set on the repo, the preview gate cannot reach the API behind protection, so it fails at the wall rather than at the domain check.

## Addendum (Aug 2026): why `gcloud iam oauth-clients` cannot back Firebase Google sign-in

A follow-up incident on the same project: Google sign-in was enabled in the
console and the Identity Platform `defaultSupportedIdpConfigs/google.com`
record existed, yet the browser popup still failed. The admin API and the
`createAuthUri` SDK surface both looked healthy — the actual failure only
appeared when Google's own OAuth endpoint was hit: **"The OAuth client was
not found"** (`invalid_client`).

**Root cause:** the client had been created with `gcloud iam oauth-clients`,
which provisions clients in the **IAM Workforce Identity Federation / IAP
registry**. Those clients get UUID-style ids (e.g.
`af28e1eb0-e4d3-4c68-9ef0-3a8a2c5f696f`) and are designed for workforce
identity and IAP access — they are **not** registered with Google's consumer
OAuth system that `accounts.google.com/o/oauth2/v2/auth` (and therefore
Firebase Auth's Google popup) resolves against. No amount of propagation fixes
this: it is an architectural mismatch, not a delay.

**What Firebase actually needs:** a *classic* web OAuth client id in the form
`{projectNumber}-{hash}.apps.googleusercontent.com` plus its `GOCSPX-…`
secret, stored in the IdP record. Classic clients can only be created in the
GCP console (Google Auth Platform → Clients → Create Client → Web
application) with `https://<auth-domain>/__/auth/handler` as an authorized
redirect URI — there is no public API or gcloud command for them. The console
Google toggle normally auto-creates this client and the record; on this
project that toggle kept failing to land (it was applied to a different
project under the same account), so the record was created via the admin API
and the classic client manually.

**How it is wired now:** `scripts/wire-google-client.mjs` PATCHes
`clientId`/`clientSecret`/`enabled` into the record and then verifies at four
layers — admin GET round-trip, `accounts.google.com` recognizing the client,
and the SDK `createAuthUri` embedding the classic id. Its `isClassicWebClientId`
/ `isClassicClientSecret` guards (tested in `scripts/wire-google-client.test.ts`)
reject the UUID format on sight, so the wrong-kind-client failure mode is
caught before it ever reaches the record.

**Lesson:** when Google sign-in breaks, verify the *client id format* in the
IdP record, not just that the record exists. A Workforce client passes every
admin-API check and still fails at Google's door.

## Files

- `.freebuff/add-auth-domains.py` (gitignored helper, not committed)
- `scripts/verify-auth-domains.mjs` (committed gate)
- `scripts/verify-prod-signin.mjs` (committed end-to-end sign-in + Firestore sync proof)
- `scripts/wire-google-client.mjs` + `scripts/wire-google-client.test.ts` (classic-client wiring + format guards)
