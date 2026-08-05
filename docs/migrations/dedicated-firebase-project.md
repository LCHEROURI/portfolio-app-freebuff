# Migration plan: move this app onto its own Firebase project

## Decision (locked Aug 2026)

- **New project id: `portfolio-app-freebuff`** — created, web app registered.
- **Data fate: fresh start.** The new project starts empty; users re-sign-in
  and can re-import from local demo data (`migrateLocalDemoToFirestore`). No
  export/import of the old rows.
- **The meal-planner project is untouched** — nothing is deleted or modified
  there.

## Status (executed Aug 2026)

Done: project created, web app registered, `.env.local` + Vercel swapped,
three hardcoded defaults fixed, `firestore.rules` trimmed + deployed
(`firebase deploy --only firestore:rules --project portfolio-app-freebuff`
PASS), Firestore database created (FIRESTORE_NATIVE, nam5), test fixtures
updated, `FIREBASE_WEB_API_KEY` repo secret updated to the new project's key.

Pending (manual console steps):
1. **Open the new project's Authentication page once** —
   https://console.firebase.google.com/project/portfolio-app-freebuff/authentication
   CLI-created projects don't get an Identity Platform config record until
   the console provisions it (`CONFIGURATION_NOT_FOUND` otherwise). This
   unblocks authorized domains + sign-in providers.
2. **Generate the service account** (Project settings → Service accounts →
   Generate new private key) → `FIREBASE_SERVICE_ACCOUNT` on Vercel.
3. Optional: `REPORT_OWNER_ID` with a real uid.

Then: push the migration commit, redeploy, run all four verify gates.

## Goal

Today the app shares the `meal-planner-lcherouri` Firebase project (Auth,
Firestore, authorized domains, service-account scope). That project belongs to
the separate Weeknight Meal Planner app. This migration moves App Portfolio
Command Center onto a **dedicated Firebase project** so it owns its Auth,
rules, domains, and service account — and stops touching the meal-planner's
data and settings.

## Current state (confirmed by sweep, Aug 2026)

The app resolves its Firebase config **entirely through env vars**, so the
migration is a config + rules change, not a code rewrite. Everything below
currently points at `meal-planner-lcherouri`:

| Touchpoint | Location | Change needed |
| --- | --- | --- |
| Local dev config | `.env.local` — 6 `NEXT_PUBLIC_FIREBASE_*` values | swap to new project values |
| Vercel env | Production `NEXT_PUBLIC_FIREBASE_*` (6 vars) | swap to new project values |
| Service account | `FIREBASE_SERVICE_ACCOUNT` — not set anywhere yet | generate for the new project; add to `.env.local` + Vercel |
| Auth-domain helper | `scripts/authorize-domain.mjs` line 25 — hard default `'meal-planner-lcherouri'` | change default to new project id |
| Domain helper (local) | `.freebuff/add-auth-domains.py` line 34 `PROJECT` + lines 42-44 domain list | new project id + portfolio domain list |
| CI | `.github/workflows/ci.yml` lines 83 + 168 — `NEXT_PUBLIC_FIREBASE_PROJECT_ID: meal-planner-lcherouri` | new project id in both jobs |
| Rules | `firestore.rules` — 235 lines, SECTION A (meal-planner, lines 25-158) + SECTION B (portfolio, 160-229) + catch-all | keep only SECTION B + catch-all |
| Rules spec test | `lib/firestoreRules.test.ts` — asserts every meal-planner collection + subcollection owner checks | drop Section A assertions, keep Section B |
| Rules verifier | `scripts/verify-firestore-rules.mjs` lines 150-151 — writes/reads `mealPlans/<id>` for stranger denial | drop Section A probes; keep portfolio write/read/deny |
| Unit tests (fixtures) | `AuthGate.test.tsx`, `authDomains.test.ts`, `authErrors.test.ts`, `server/status.test.ts`, `cron/reports/route.test.ts` | keep as-is or update fixtures to new id (cosmetic) |
| Docs | `docs/reviews/2026-08-04-authorized-domains.md` (records the shared-project decision) | add a note pointing at this plan |
| README | production-setup section documents env vars generically | no id hardcoded — no change |

Verify scripts that already resolve the project id from env (no change needed,
they follow the swap automatically): `verify-prod-signin.mjs`,
`verify-auth-domains.mjs`, `verify-firestore-rules.mjs` (via
`NEXT_PUBLIC_FIREBASE_PROJECT_ID`), `verify-cron-email.mjs` (hits the deployed
URL). `lib/firebase.ts`, `lib/server/firestoreAdmin.ts`, `sa-token.mjs`, and
the `firestore.rules` deploy (`firebase.json`) all read the id from env too.

## Phase 0 — decisions (already made)

1. **Project id: `portfolio-app-freebuff`** — created via
   `firebase projects:create` and confirmed in the console.
2. **Data fate: fresh start.** The new project starts empty. Users re-sign-in
   and can re-import from local demo data (the app already supports
   `migrateLocalDemoToFirestore`). No export/import tooling, no risk of
   copying a stranger's rows.

## Phase 1 — create the new Firebase project (console, manual)

1. https://console.firebase.google.com → **Add project** → name it, accept
   the GCP terms. Note: this also creates a GCP project with the same id.
2. **Register a web app** (Project settings → Your apps → `</>`). Copy the 6
   SDK values: `apiKey`, `authDomain`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`.
3. **Enable sign-in providers** (Authentication → Sign-in method): Email /
   Password and Google (match what the app offers).
4. **Authorized domains** (Authentication → Settings → Authorized domains):
   add `localhost`, `portfolio-app-freebuff.vercel.app`, and every active
   preview URL (Vercel preview domains rotate; add the current ones, and the
   automated domain helper will keep adding them). `*.vercel.app` wildcards
   are rejected — add exact hostnames only.
5. **Create the service account** (Project settings → Service accounts →
   Generate new private key). Grant it Firestore access
   (`roles/datastore.user`) for the automation cron. This JSON is
   `FIREBASE_SERVICE_ACCOUNT` — the credential this thread has been waiting
   on.

## Phase 2 — swap env config (local + Vercel)

1. `.env.local`: replace the 6 `NEXT_PUBLIC_FIREBASE_*` lines with the new
   web-app values.
2. Vercel → Project → Settings → Environment Variables (Production): update
   the same 6 vars to the new values.
3. Vercel: add `FIREBASE_SERVICE_ACCOUNT` (the new project's SA JSON) —
   this activates the Firestore-backed cron, the winner-recommendation
   email, and the seeder.
4. Optional: add `REPORT_OWNER_ID` with a real account uid if the emailed
   report should scope to a signed-in account rather than `demo-user`.

## Phase 3 — repo code/config changes

### 3a. Exact edits to the hardcoded project-id defaults

**`scripts/authorize-domain.mjs` line 25** — change the fallback default:

```diff
-const PROJECT = process.env.FIREBASE_PROJECT_ID ?? 'meal-planner-lcherouri';
+const PROJECT = process.env.FIREBASE_PROJECT_ID ?? '<NEW_PROJECT_ID>';
```

**`.freebuff/add-auth-domains.py` line 34** — change the project id:

```diff
-PROJECT = 'meal-planner-lcherouri'
+PROJECT = '<NEW_PROJECT_ID>'
```

**`.freebuff/add-auth-domains.py` lines 42-44** — replace the meal-planner
base hosts with the new project's hosts (these are the never-pruned base
domains; the `PREVIEW_RE` pattern for rotating preview URLs stays unchanged):

```diff
 BASE_HOSTS = {
     'localhost',
-    'meal-planner-lcherouri.firebaseapp.com',
-    'meal-planner-lcherouri.web.app',
-    'ai-meal-planner-rho-two.vercel.app',
-    'kun-meals.vercel.app',
-    'freebuff-meal.vercel.app',
+    '<NEW_PROJECT_ID>.firebaseapp.com',
+    '<NEW_PROJECT_ID>.web.app',
     'portfolio-app-freebuff.vercel.app',
 }
```

**`.github/workflows/ci.yml` lines 83 and 168** — both jobs set the project
id explicitly (the app's other verify scripts read it from env, but these two
hardcode it so CI runs against the right project regardless of runner env):

```diff
-          NEXT_PUBLIC_FIREBASE_PROJECT_ID: meal-planner-lcherouri
+          NEXT_PUBLIC_FIREBASE_PROJECT_ID: <NEW_PROJECT_ID>
```

### 3b. The exact `firestore.rules` to deploy (portfolio-only)

Delete SECTION A (everything from `// SECTION A` through the end of the
`pantryItems` block, lines 25-158) and the now-unused `isOwner` /
`isPositiveInt` helpers. **Keep `isAuthed()`** — Section B's rules call it.
The deployed file is exactly:

```
rules_version = '2';
// ============================================================================
// App Portfolio Command Center — dedicated Firestore security rules.
//
// Single-app ruleset. Per-user isolation: every document is scoped to the
// authenticated uid. `profiles` docs are keyed by the user's uid (the app
// writes the profile at profiles/<uid> with no inner userId field), so that
// rule matches on the document id. All other collections carry a `userId`
// field which must equal the authenticated uid. Reads of a not-yet-existing
// document are allowed (resource == null) so a first-run `getDoc` returns
// NOT_FOUND instead of a spurious 403.
//
// Deploy with:
//   firebase deploy --only firestore:rules --project <NEW_PROJECT_ID>
// ============================================================================
service cloud.firestore {
  match /databases/{database}/documents {

    function isAuthed() {
      return request.auth != null;
    }

    // --- Profiles (keyed by uid) ---
    match /profiles/{profileId} {
      allow read: if isAuthed()
        && (resource == null || profileId == request.auth.uid);
      allow create, update, delete: if isAuthed()
        && profileId == request.auth.uid;
    }

    // --- Portfolio collections (userId field isolation) ---
    match /projects/{document} {
      allow read, update, delete: if isAuthed()
        && (resource == null || resource.data.userId == request.auth.uid);
      allow create: if isAuthed()
        && request.resource.data.userId == request.auth.uid;
    }
    match /project_versions/{document} {
      allow read, update, delete: if isAuthed()
        && (resource == null || resource.data.userId == request.auth.uid);
      allow create: if isAuthed()
        && request.resource.data.userId == request.auth.uid;
    }
    match /repositories/{document} {
      allow read, update, delete: if isAuthed()
        && (resource == null || resource.data.userId == request.auth.uid);
      allow create: if isAuthed()
        && request.resource.data.userId == request.auth.uid;
    }
    match /deployments/{document} {
      allow read, update, delete: if isAuthed()
        && (resource == null || resource.data.userId == request.auth.uid);
      allow create: if isAuthed()
        && request.resource.data.userId == request.auth.uid;
    }
    match /tasks/{document} {
      allow read, update, delete: if isAuthed()
        && (resource == null || resource.data.userId == request.auth.uid);
      allow create: if isAuthed()
        && request.resource.data.userId == request.auth.uid;
    }
    match /model_evaluations/{document} {
      allow read, update, delete: if isAuthed()
        && (resource == null || resource.data.userId == request.auth.uid);
      allow create: if isAuthed()
        && request.resource.data.userId == request.auth.uid;
    }
    match /activity/{document} {
      allow read, update, delete: if isAuthed()
        && (resource == null || resource.data.userId == request.auth.uid);
      allow create: if isAuthed()
        && request.resource.data.userId == request.auth.uid;
    }
    match /reports/{document} {
      allow read, update, delete: if isAuthed()
        && (resource == null || resource.data.userId == request.auth.uid);
      allow create: if isAuthed()
        && request.resource.data.userId == request.auth.uid;
    }

    // --- Catch-all (deny everything else) — keep last. ---
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

This is ~75 lines: 9 portfolio collections with the same `userId == auth.uid`
isolation, `profiles` keyed by uid, the `isAuthed()` helper, and the
recursive catch-all deny. Deploy with
`npx firebase deploy --only firestore:rules --project <NEW_PROJECT_ID>`
(`.firebaserc` is empty and there is no `firebase.json` in this repo yet, so
the `--project` flag is mandatory).

### 3c. Test and verifier updates (same commit)

1. `lib/firestoreRules.test.ts`: delete the `MEAL_PLANNER` const and its four
   Section A tests (meal-planner collections present, subcollection owner
   checks, `publicShares` single-get, field-level create constraints). Keep
   the portfolio coverage + per-user isolation tests and the catch-all-deny
   test (the `PORTFOLIO` loop needs no change — it already covers only
   Section B).
2. `scripts/verify-firestore-rules.mjs`: delete the "Meal-planner collections
   (Section A)" probe block — the `users/<uid>` create/read, the
   `users/<stranger>` and `mealPlans/<stranger>` denial probes. Keep the
   portfolio block (create `profiles/<uid>`, read it, create
   `projects/<probe>`, read it, cross-user create denied). The throwaway
   user + cleanup logic stays.
3. `docs/reviews/2026-08-04-authorized-domains.md`: add a pointer to this
   plan so the record doesn't look stale.
4. Optional: update unit-test fixtures (`AuthGate`, `authDomains`,
   `authErrors`, `status`, `cron route`) to the new project id — cosmetic,
   they already pass with any id.

## Phase 4 — deploy rules + app

1. Deploy the trimmed rules to the **new** project:
   `npx firebase deploy --only firestore:rules --project <new-id>`
   (`firebase.json` already points at `firestore.rules`; `.firebaserc` is
   currently empty, so the `--project` flag is mandatory).
2. Push the code changes; CI + Vercel redeploy. The app now signs in and
   reads/writes the new project.
3. Set the new `FIREBASE_WEB_API_KEY` (and confirm `CRON_SECRET`) GitHub
   Actions secrets if the verify jobs should keep running.

## Phase 5 — verify (the gates prove it)

```bash
npm run verify:auth-domains          # /api/status?project=<domain> → ok
npm run verify:firestore-rules       # portfolio write/read, cross-user denied
npm run verify:prod-signin           # sign in + Firestore sync on the live URL
node scripts/verify-cron-email.mjs   # email bodies (once FIREBASE_SERVICE_ACCOUNT is on Vercel)
```

All four read the project id from env, so they validate the new project after
the swap. Then, once `FIREBASE_SERVICE_ACCOUNT` exists:

```bash
npm run seed:winner-candidates -- --owner demo-user --list   # confirm clean
npm run seed:winner-candidates -- --owner demo-user          # seed fixture
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://portfolio-app-freebuff.vercel.app/api/cron/reports?kind=weekly&previewBody=1"
# → reports[0].body contains "## 🏆 AI winner recommendations (DeepSeek Chat)"
```

## Rollback

The old project is untouched by this migration (nothing is deleted from
`meal-planner-lcherouri`). Rollback = revert the 6 env vars + the code
changes + redeploy + re-deploy the merged rules to the old project. The
shared ruleset still exists in git history (`09e2b56` era) if needed.

## Tradeoffs / decisions to confirm

- **Data fate** (fresh start vs export/import) — the biggest decision; pick
  before Phase 1.
- **New project id** — must be chosen before Phase 1; it's permanent.
- **Existing users** must re-sign-in (fresh start) or the export/import path
  must be executed.
- **The meal-planner project keeps its data** — this migration only stops the
  portfolio app from touching it; nothing is cleaned up there automatically.
- **Service account scope** shrinks from "both apps' data" to "portfolio
  only", which is the security win of this migration.
