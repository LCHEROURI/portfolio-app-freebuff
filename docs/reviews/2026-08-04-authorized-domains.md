# Postmortem, authorized-domains sign-in blocker, 2026-08-04

**Severity**: High (all sign-in blocked on the production domain)
**Status**: Resolved, deployed, and proven end to end
**Symptoms**: `Error (auth/unauthorized-domain)` on https://portfolio-app-freebuff.vercel.app — the AuthGate refused every sign-in and the Integrations panel's authorized-domains check reported `ok: false` for the production origin.

## What happened

The app runs Firebase Auth on the shared `meal-planner-lcherouri` project. The project's `authorizedDomains` list was the meal-planner's original set (localhost, the firebaseapp.com / web.app hosts, and three older Vercel apps). `portfolio-app-freebuff.vercel.app` was never added, so Identity Platform rejected every sign-in from that origin with `auth/unauthorized-domain`.

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

Firebase's validator rejects wildcard entries in `authorizedDomains` with `INVALID_AUTHORIZED_DOMAIN`. A pattern like `portfolio-app-freebuff-*.vercel.app` is not accepted; only exact hostnames. Each Vercel preview gets a unique hostname, so a preview must either be added by its exact URL or sign-in there stays blocked (the reasonable default for throwaway deploys).

## How the gate is proven

`scripts/verify-auth-domains.mjs` mints a throwaway Identity Toolkit user, calls the deployed `/api/status?project=<target-domain>`, and asserts the Firebase `authDomains.ok` flag for that origin. It exits nonzero otherwise. The same script drives CI: `verify-auth-domains` on push (production domain) and `preview-gate.yml` on `deployment_status` (the exact deployment URL Vercel just handed out).

End-to-end proof after the fix, all PASS:

- `npm run verify:auth-domains` against production: `portfolio-app-freebuff.vercel.app` is in the authorized list.
- `scripts/verify-prod-signin.mjs`: a real headless-Chrome sign-in from the production origin — AuthGate renders, credentials are typed and submitted, the gate releases into the Command Center shell, and a Firestore probe document is written and read back under the signed-in account (rules allow owner reads).
- Exact preview deployment URLs added via the helper and verified through the public endpoint.

## Prevention

- The CI gates stay in place: every push re-proves the production domain is authorized, and every Vercel deployment re-proves the exact URL it shipped.
- Adding a domain is now a one-line idempotent helper call instead of a manual console step, so future projects can be unblocked without hunting through the console.

## Files

- `.freebuff/add-auth-domains.py` (gitignored helper, not committed)
- `scripts/verify-auth-domains.mjs` (committed gate)
- `scripts/verify-prod-signin.mjs` (committed end-to-end sign-in + Firestore sync proof)
