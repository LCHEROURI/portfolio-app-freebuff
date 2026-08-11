import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { EXPECTED_LIVE_FLAGS } from './verify-vercel-env.mjs';

// ============================================================================
// scripts/ci-workflows.test.ts — lock the CI post-deploy surface contract.
//
// The pre-push hook locks the LOCAL gate suite; CI is the OTHER half of the
// gate surface — the post-deploy jobs that run against the live app on every
// push (and the deployment_status workflows that fire after each Vercel
// deploy). This test reads the REAL workflow files from disk (never fixtures)
// and asserts the load-bearing steps still exist and are still gated on their
// secrets, so a future edit that silently drops a post-deploy gate fails here
// instead of letting a green run masquerade as full verification.
//
// Scope discipline (learned from the pre-push test's vacuous-pass traps):
// assertions on the verify-deployed job are scoped to the JOB BLOCK (from
// `verify-deployed:` to the next top-level job), not the whole file — so a
// step name mentioned in another job's comment can't satisfy the check. And
// the gating `if:` on each step is asserted too: an ungated step would still
// contain the script name, but would run where its secret is missing and the
// gate would silently no-op.
// ============================================================================

const CI = readFileSync('.github/workflows/ci.yml', 'utf8');
const PREVIEW_GATE = readFileSync('.github/workflows/preview-gate.yml', 'utf8');
const DEPLOYED_HASH = readFileSync('.github/workflows/verify-deployed-hash.yml', 'utf8');
const GALLERY = readFileSync('.github/workflows/gallery.yml', 'utf8');
const GALLERY_STABILITY = readFileSync('.github/workflows/gallery-stability.yml', 'utf8');

// The gallery capture job gates its Deploy / Wait / Capture steps on the
// same env trio; each of the three steps must carry it, so a drop on any
// one step is caught by counting occurrences rather than a bare toContain.
const GALLERY_ENV_TRIO = "if: ${{ env.VERCEL_TOKEN != '' && env.VERCEL_ORG_ID != '' && env.VERCEL_PROJECT_ID != '' }}";
// The Wait and Capture steps both wire the live preview URL into their env;
// exactly two wirings must survive.
const PREVIEW_URL_WIRING = 'PREVIEW_URL: ${{ steps.deploy.outputs.url }}';

// The verify-deployed job block: everything between the job key and the next
// top-level job (`verify-auth-domains:`). Scoping here keeps every step
// assertion honest — a script name can only match inside this job.
const verifyDeployedBlock = CI.slice(CI.indexOf('verify-deployed:'), CI.indexOf('verify-auth-domains:'));

describe('.github/workflows/ci.yml · validate job (docs-render coverage)', () => {
  // The validate job block: everything between the job key and the next
  // top-level job (`verify-launch-checklist:`). Scoping here keeps every
  // assertion honest — the step name and its Chrome wiring can only match
  // inside this job, never in a comment elsewhere in the file.
  const validateBlock = CI.slice(CI.indexOf('\n  validate:'), CI.indexOf('\n  verify-launch-checklist:'));

  it('keeps the dimension-test Chrome install + Test env wiring (CI docs-render coverage)', () => {
    // A non-empty block guard: if the jobs are ever reordered so the slice
    // resolves to '', every toContain below would fail confusingly.
    expect(validateBlock.length).toBeGreaterThan(0);
    // The dimension test re-renders the two docs PNGs on the runner and
    // asserts sane bounds (width 1200, height 2000-6000), so a broken
    // renderer fails CI. The Chrome install and the Test step's CHROME_PATH
    // wiring are what make that check actually execute on the Linux runner
    // (the /Applications fallback does not exist there).
    expect(validateBlock).toContain('Install Chrome for docs-render dimension test');
    expect(validateBlock).toContain('uses: browser-actions/setup-chrome@v2');
    expect(validateBlock).toContain('CHROME_PATH: ${{ steps.chrome.outputs.chrome-path }}');
  });

  it('does NOT run the docs-render BYTE gate on the runner (not byte-reproducible there)', () => {
    // The byte gate (gate 0.6c) compares fresh renders against committed PNGs
    // produced on the developer's macOS. Hosted runners render different font
    // metrics (observed: handoff 4609px committed vs 4556px on the runner),
    // so the gate can never pass there — re-adding it as a step would make
    // every push red. The authoritative byte gate lives in the pre-push hook
    // (the same machine that produced the PNGs); CI covers the renders via
    // the dimension test above and the gallery workflow's re-capture.
    expect(validateBlock).not.toContain('Verify docs-render diff (gate 0.6c)');
    expect(validateBlock).not.toContain('run: npm run verify:docs-render');
    // The decision must stay documented in the workflow, so a future edit
    // that re-adds the gate without consciously re-deciding fails here.
    expect(validateBlock).toContain('byte-compares fresh renders against committed PNGs');
  });
});

describe('.github/workflows/ci.yml · validate job (stale-head guards, ported from the cook repo)', () => {
  // The validate job block — scoped exactly like the docs-render describe
  // above so step names can never match in another job's comments.
  const validateBlock = CI.slice(CI.indexOf('\n  validate:'), CI.indexOf('\n  verify-launch-checklist:'));

  it('runs the push-time stale-guard, gated on push + VERCEL_TOKEN', () => {
    expect(validateBlock).toContain('name: Verify pushed head is not stale vs live (stale-guard)');
    expect(validateBlock).toContain('node scripts/verify-deployed-hash-gate.mjs --stale-guard');
    expect(validateBlock).toContain("if: ${{ github.event_name == 'push' && env.VERCEL_TOKEN != '' }}");
    expect(validateBlock).toContain('VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}');
  });

  it('fails loudly when VERCEL_TOKEN is missing on a main push (no silent skip)', () => {
    expect(validateBlock).toContain('name: Fail loudly if VERCEL_TOKEN is missing (main push)');
    expect(validateBlock).toContain("github.event_name == 'push'");
    expect(validateBlock).toContain("github.repository == 'LCHEROURI/portfolio-app-freebuff'");
    expect(validateBlock).toContain("env.VERCEL_TOKEN == ''");
    expect(validateBlock).toContain('exit 1');
  });

  it('runs the PR-time stale-guard pinned to the PR head via --head, gated on pull_request + VERCEL_TOKEN', () => {
    expect(validateBlock).toContain('name: Verify PR head is not stale vs live (stale-guard)');
    expect(validateBlock).toContain('node scripts/verify-deployed-hash-gate.mjs --stale-guard --head "${{ github.event.pull_request.head.sha }}"');
    expect(validateBlock).toContain("if: ${{ github.event_name == 'pull_request' && env.VERCEL_TOKEN != '' }}");
    expect(validateBlock).toContain('VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}');
  });

  it('fails loudly when VERCEL_TOKEN is missing on a PR (no silent skip on the canonical repo)', () => {
    expect(validateBlock).toContain('name: Fail loudly if VERCEL_TOKEN is missing (PR)');
    expect(validateBlock).toContain("github.event_name == 'pull_request'");
    expect(validateBlock).toContain("github.repository == 'LCHEROURI/portfolio-app-freebuff'");
    expect(validateBlock).toContain('exit 1');
  });

  it('keeps the push stale-guard strictly push-only and the PR stale-guard strictly PR-only', () => {
    // Negative locks, mirroring the cook repo's contract: the push step must
    // never fire on pull_request (a PR head is legitimately behind live main)
    // and the PR step must never fire on push (the push contract belongs to
    // the step above). Scoped to each step block so the sibling step's gating
    // can never satisfy the negative.
    const pushStep = validateBlock.slice(
      validateBlock.indexOf('name: Verify pushed head is not stale vs live (stale-guard)'),
      validateBlock.indexOf('\n      # PR-time stale-head guard'),
    );
    expect(pushStep).toContain("github.event_name == 'push'");
    expect(pushStep).not.toContain('pull_request');
    const prStep = validateBlock.slice(
      validateBlock.indexOf('name: Verify PR head is not stale vs live (stale-guard)'),
    );
    expect(prStep).toContain("github.event_name == 'pull_request'");
    expect(prStep).not.toContain("github.event_name == 'push'");
  });
});

describe('.github/workflows/ci.yml · verify-auth-domains job (push-time domains gate)', () => {
  it('still verifies the deployed authorized domains and the auto-authorize SA key', () => {
    const authDomainsBlock = CI.slice(CI.indexOf('verify-auth-domains:'), CI.indexOf('verify-prod-signin:'));
    expect(authDomainsBlock.length).toBeGreaterThan(0);
    expect(authDomainsBlock).toContain('name: Verify authorized domains');
    expect(authDomainsBlock).toMatch(/run: node scripts\/verify-auth-domains\.mjs/);
    expect(authDomainsBlock).toContain("if: ${{ env.FIREBASE_WEB_API_KEY != '' }}");
    // The SA-key validity step proves the auto-authorize credential is alive
    // on every push, not just on deployment_status events.
    expect(authDomainsBlock).toContain('Verify auto-authorize service account key');
    expect(authDomainsBlock).toMatch(/run: node scripts\/authorize-domain\.mjs --domain/);
  });
});

describe('.github/workflows/ci.yml · verify-deployed job (post-deploy smoke gates)', () => {
  it('defines the verify-deployed job gated on push / manual re-verify', () => {
    // A non-empty block guard: if the two jobs are ever reordered so
    // verify-auth-domains precedes verify-deployed, the slice would return ''
    // and every toContain below would fail confusingly. This turns that
    // reorder into a legible failure naming the real cause.
    expect(verifyDeployedBlock.length).toBeGreaterThan(0);
    expect(verifyDeployedBlock).toContain('name: Verify deployed cron reports + rules');
    expect(verifyDeployedBlock).toContain("if: ${{ github.event_name == 'push' || github.event_name == 'workflow_dispatch' }}");
  });

  it('keeps the loud-secret guard so a missing secret fails instead of silently skipping', () => {
    // The gated steps below skip-not-fail when their secret is absent; the
    // loud guard is what stops that skip from masquerading as a green run on
    // a main push. Dropping it would let every step no-op while CI still
    // reports success — the exact regression this suite exists to catch.
    expect(verifyDeployedBlock).toContain('Fail loudly if a verify secret is missing (main push)');
    expect(verifyDeployedBlock).toContain('::error::Required GitHub Actions secret(s) missing on main push:');
    expect(verifyDeployedBlock).toContain("github.repository == 'LCHEROURI/portfolio-app-freebuff'");
  });

  it('still runs the Vercel token-health step, gated on VERCEL_TOKEN', () => {
    expect(verifyDeployedBlock).toMatch(/run: node scripts\/verify-token-health\.mjs/);
    expect(verifyDeployedBlock).toContain("if: ${{ env.VERCEL_TOKEN != '' }}");
    expect(verifyDeployedBlock).toContain('VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}');
  });

  it('still runs the deployed cron report bodies step, gated on CRON_SECRET', () => {
    expect(verifyDeployedBlock).toMatch(/run: node scripts\/verify-cron-reports\.mjs/);
    expect(verifyDeployedBlock).toContain("if: ${{ env.CRON_SECRET != '' }}");
    expect(verifyDeployedBlock).toContain('CRON_SECRET: ${{ secrets.CRON_SECRET }}');
  });

  it('still runs the Firestore rules step, gated on the verification-sandbox pair', () => {
    // The rules gate probes the VERIFICATION SANDBOX (a second Spark project)
    // so CI never touches the production read quota; it must never fall back
    // to production here. Both sandbox vars are gated (a missing one skips
    // only on forks), and the service account is passed so the gate's
    // sandbox↔production rules-parity sub-check can run.
    expect(verifyDeployedBlock).toMatch(/run: node scripts\/verify-firestore-rules\.mjs/);
    expect(verifyDeployedBlock).toContain("if: ${{ env.VERIFY_FIREBASE_WEB_API_KEY != '' && env.VERIFY_FIREBASE_PROJECT_ID != '' }}");
    expect(verifyDeployedBlock).toContain('VERIFY_FIREBASE_WEB_API_KEY: ${{ secrets.VERIFY_FIREBASE_WEB_API_KEY }}');
    expect(verifyDeployedBlock).toContain('VERIFY_FIREBASE_PROJECT_ID: ${{ secrets.VERIFY_FIREBASE_PROJECT_ID }}');
    expect(verifyDeployedBlock).toContain('FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}');
  });

  it('still runs the Google sign-in IdP config step, gated on FIREBASE_WEB_API_KEY', () => {
    expect(verifyDeployedBlock).toMatch(/run: node scripts\/verify-google-idp\.mjs/);
    expect(verifyDeployedBlock).toContain("if: ${{ env.FIREBASE_WEB_API_KEY != '' }}");
    expect(verifyDeployedBlock).toContain('FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}');
  });

  it('still runs the review-sheet print-all gate, gated on the Firebase pair with Chrome', () => {
    // The review-sheet gate (verify-review-sheet.mjs) drives the deployed
    // Model Comparison page — the print-all contract must be CI-proven after
    // every deploy, not just via verify:all and pre-push. It needs the same
    // credential pair as prod-signin (web API key mints the throwaway user,
    // service account seeds the fixture), both gated so a missing secret
    // skips-not-fails only on forks, and a Chrome binary for the CDP driver
    // (the Linux runner has no /Applications fallback).
    expect(verifyDeployedBlock).toMatch(/run: node scripts\/verify-review-sheet\.mjs/);
    expect(verifyDeployedBlock).toContain("if: ${{ env.FIREBASE_WEB_API_KEY != '' && env.FIREBASE_SERVICE_ACCOUNT != '' }}");
    expect(verifyDeployedBlock).toContain('FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}');
    expect(verifyDeployedBlock).toContain('NEXT_PUBLIC_FIREBASE_PROJECT_ID: portfolio-app-freebuff2');
    expect(verifyDeployedBlock).toContain('Install Chrome for review-sheet CDP');
    expect(verifyDeployedBlock).toContain('CHROME_PATH: ${{ steps.chrome-review-sheet.outputs.chrome-path }}');
  });

  it('still runs the deployments feed gate, gated on FIREBASE_WEB_API_KEY', () => {
    // The deployments gate (verify-deployments.mjs) proves the deployed
    // /api/deployments feed returns real Firebase + Vercel rows with HEALTHY
    // health checks after every deploy — guarding the firebasehosting host
    // fix and the name→id Vercel resolution. It mints its probe user from
    // the web API key, so it needs only that one secret.
    expect(verifyDeployedBlock).toMatch(/run: node scripts\/verify-deployments\.mjs/);
    expect(verifyDeployedBlock).toContain("if: ${{ env.FIREBASE_WEB_API_KEY != '' }}");
    expect(verifyDeployedBlock).toContain('FIREBASE_WEB_API_KEY: ${{ secrets.FIREBASE_WEB_API_KEY }}');
  });

  it('still runs the deployed PDF route gate, gated on the owner-session trio', () => {
    // The deployed-pdf gate (verify-deployed-pdf.mjs) POSTs a PrintDoc to the
    // DEPLOYED /api/print/pdf AS THE REAL OWNER (SA-minted custom token for
    // REPORT_OWNER_ID exchanged for an idToken) and asserts a real %PDF-
    // response with an attachment filename — the contract that 503'd on
    // Vercel (no Chrome binary, untraced chromium.br, no /dev/shm). It needs
    // all three of the owner-session credentials, each gated so a missing
    // secret skips-not-fails only on forks.
    expect(verifyDeployedBlock).toMatch(/run: node scripts\/verify-deployed-pdf\.mjs/);
    expect(verifyDeployedBlock).toContain("if: ${{ env.FIREBASE_WEB_API_KEY != '' && env.FIREBASE_SERVICE_ACCOUNT != '' && env.REPORT_OWNER_ID != '' }}");
    expect(verifyDeployedBlock).toContain('FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}');
    expect(verifyDeployedBlock).toContain('REPORT_OWNER_ID: ${{ secrets.REPORT_OWNER_ID }}');
    // The loud guard must name the new secret, so a missing REPORT_OWNER_ID
    // on a main push fails the run instead of silently skipping the gate.
    expect(verifyDeployedBlock).toContain("env.REPORT_OWNER_ID == ''");
    expect(verifyDeployedBlock).toContain('REPORT_OWNER_ID: ${{ secrets.REPORT_OWNER_ID }}');
  });

  it('still runs the Reports Download PDF UI gate, gated on the trio + Chrome', () => {
    // The reports-pdf-flow gate (verify-reports-pdf-flow.mjs) drives the
    // DEPLOYED /reports page in headless Chrome as the REAL OWNER, clicks the
    // actual Download PDF button, and captures the browser download via CDP —
    // the full UI path (button → auth facade → route → blob → file), not just
    // the API. It needs the same owner-session trio as deployed-pdf PLUS a
    // Chrome binary (the Linux runner has no /Applications fallback).
    expect(verifyDeployedBlock).toMatch(/run: node scripts\/verify-reports-pdf-flow\.mjs/);
    expect(verifyDeployedBlock).toContain("if: ${{ env.FIREBASE_WEB_API_KEY != '' && env.FIREBASE_SERVICE_ACCOUNT != '' && env.REPORT_OWNER_ID != '' }}");
    expect(verifyDeployedBlock).toContain('Install Chrome for reports-pdf CDP');
    expect(verifyDeployedBlock).toContain('CHROME_PATH: ${{ steps.chrome-reports-pdf.outputs.chrome-path }}');
  });

  it('wires the full EXPECTED_LIVE_FLAGS set into the verify-deployed job env', () => {
    // The deployed-store LIVE-flag set (source of truth: EXPECTED_LIVE_FLAGS
    // in verify-vercel-env.mjs) must be declared in this job's env so the
    // workflow stays locked to the same set the local gate asserts. A flag
    // added to EXPECTED_LIVE_FLAGS without this wiring — or a flag dropped
    // here while still required — fails below: CI can never silently drift
    // from the gate's deployed-store contract.
    expect(Object.keys(EXPECTED_LIVE_FLAGS).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(EXPECTED_LIVE_FLAGS)) {
      expect(verifyDeployedBlock).toContain(`${key}: '${value}'`);
    }
  });
});

describe('.github/workflows/preview-gate.yml · deployment_status preview gate', () => {
  it('triggers on deployment_status and only on successful deploys with a target URL', () => {
    expect(PREVIEW_GATE).toMatch(/^on:\s*\n\s*deployment_status:/m);
    expect(PREVIEW_GATE).toContain("github.event.deployment_status.state == 'success'");
    expect(PREVIEW_GATE).toContain("github.event.deployment_status.target_url != ''");
  });

  it('still verifies the deployed domain is authorized against the live target_url', () => {
    // The verify runs inside a `run: |` block (wrapped in the retry function
    // below), so the invocation is an indented line, not `run: node scripts/…`.
    expect(PREVIEW_GATE).toMatch(/node scripts\/verify-auth-domains\.mjs --app/);
    expect(PREVIEW_GATE).toContain('github.event.deployment_status.target_url');
    expect(PREVIEW_GATE).toContain("if: ${{ env.FIREBASE_WEB_API_KEY != '' }}");
  });

  it('still auto-authorizes the fresh deployment URL first (SA-gated)', () => {
    expect(PREVIEW_GATE).toMatch(/run: node scripts\/authorize-domain\.mjs --domain/);
    expect(PREVIEW_GATE).toContain('github.event.deployment_status.target_url');
  });

  it('retries the verify once after a 30s backoff (Firebase getProjectConfig propagation)', () => {
    // The verify script already sends &refresh=1, but Firebase's own config
    // propagation can lag the admin-API auto-authorize by tens of seconds —
    // the documented transient that used to force manual re-runs. The gate
    // must retry ONCE after 30s (mirroring the pre-push deployed-hash retry)
    // so a transient clears on the retry, and a genuine miss still fails.
    expect(PREVIEW_GATE).toMatch(/run_verify\(\) \{/);
    expect(PREVIEW_GATE).toContain('sleep 30');
    expect(PREVIEW_GATE).toMatch(/retrying once/);
    expect(PREVIEW_GATE).toMatch(/on retry\)/);
    expect(PREVIEW_GATE).toContain('exit 1');
  });

  it('wires the full EXPECTED_LIVE_FLAGS set into the preview-gate job env', () => {
    // Same contract as the ci.yml verify-deployed and gallery jobs: every flag
    // the local gate requires in the deployed store must be declared here so
    // this deployment_status workflow stays locked to the same set. A flag
    // added to EXPECTED_LIVE_FLAGS without this wiring — or dropped here while
    // still required — fails below.
    expect(Object.keys(EXPECTED_LIVE_FLAGS).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(EXPECTED_LIVE_FLAGS)) {
      expect(PREVIEW_GATE).toContain(`${key}: '${value}'`);
    }
  });
});

describe('.github/workflows/gallery.yml · PR/dispatch gallery capture', () => {
  it('triggers on pull_request to main and workflow_dispatch, with a fork guard', () => {
    expect(GALLERY).toContain('pull_request:');
    expect(GALLERY).toMatch(/branches:\s*\[main\]/);
    expect(GALLERY).toContain('workflow_dispatch:');
    // Fork PRs cannot access secrets, so the job skips (not fails) unless the
    // PR comes from the same repo — dropping this guard would make gallery
    // runs fail loudly for every fork contributor.
    expect(GALLERY).toContain("github.event.pull_request.head.repo.full_name == github.repository");
  });

  it('still installs Chrome for headless capture (setup-chrome, chrome-version stable)', () => {
    expect(GALLERY).toContain('id: chrome');
    expect(GALLERY).toMatch(/uses: browser-actions\/setup-chrome@v2/);
    expect(GALLERY).toMatch(/chrome-version: stable/);
    // The capture step must receive the Chrome binary path; dropping the
    // output wiring would silently break every headless run.
    expect(GALLERY).toContain('CHROME_PATH: ${{ steps.chrome.outputs.chrome-path }}');
  });

  it('still deploys a preview of the branch, gated on the Vercel env trio', () => {
    expect(GALLERY).toContain('id: deploy');
    expect(GALLERY).toMatch(/npx --yes vercel deploy --yes --token=/);
    // The prebuilt flow must NOT come back: a prebuilt deploy uploads only
    // source + .vercel/output, but the serverless functions' filePathMap
    // references ROOT node_modules (styled-jsx, react, ...) that the upload
    // excludes, so "Deploying outputs" dies with ENOENT lstat
    // node_modules/styled-jsx/index.js. The remote-build path (no --prebuilt)
    // installs node_modules on the build machine first and is the proven
    // production path.
    expect(GALLERY).not.toMatch(/vercel deploy --prebuilt/);
    // The env trio gates THREE steps (Deploy, Wait, Capture); asserting the
    // count keeps a drop on any one step from passing via another's copy.
    expect(GALLERY.match(new RegExp(GALLERY_ENV_TRIO.replace(/[$\{\}]/g, '\\$&'), 'g'))).toHaveLength(3);
    expect(GALLERY).toContain('VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}');
    expect(GALLERY).toContain('VERCEL_PROTECTION_BYPASS: ${{ secrets.VERCEL_PROTECTION_BYPASS }}');
  });

  it('keeps the remote-build deploy path (no local `vercel build` step, no `--prebuilt`)', () => {
    // The prebuilt flow was broken from the gallery's first commit: it
    // uploaded only source + .vercel/output, but every serverless function's
    // .vc-config.json filePathMap references ROOT node_modules (styled-jsx,
    // react, next/dist ...) that the upload excludes, so Vercel's "Deploying
    // outputs" phase died with ENOENT lstat node_modules/styled-jsx/index.js
    // and the preview never rendered. The fix (cfaa753) dropped the local
    // `vercel build` + `--prebuilt` and lets Vercel run the remote build —
    // the proven production path. This lock keeps BOTH regressions out: a
    // reintroduced local build step or a `vercel deploy --prebuilt` command
    // fails here before it can red the gallery again. Command-form precise on
    // purpose: the deploy-step comment legitimately says "NOT `--prebuilt`"
    // to document the fix, so a bare-flag sweep would false-fail on prose.
    expect(GALLERY).not.toMatch(/vercel build/);
    expect(GALLERY).not.toMatch(/vercel deploy --prebuilt/);
    // The remote-build invocation must be the one and only deploy command…
    expect(GALLERY).toMatch(/npx --yes vercel deploy --yes --token=/);
    // …and the preview URL must be extracted from the deploy output (the
    // CLI's final line is the "run vercel --prod" hint, not the URL, so
    // tail -1 would grab the wrong line).
    expect(GALLERY).toContain('grep -oE');
  });

  it('still waits for the preview to answer HTTP 200 before capturing', () => {
    // The readiness loop must exist and must probe the live preview URL on the
    // command-center route, gated on the same env trio so it skips-not-fails
    // where no deploy could be created.
    expect(GALLERY).toContain('Wait for preview to answer HTTP 200');
    expect(GALLERY).toContain("$PREVIEW_URL/command-center");
    expect(GALLERY).toContain('Preview did not answer HTTP 200 within 300s.');
    // Exactly two steps (Wait + Capture) must wire the preview URL into their
    // env; the count (not toContain) catches a wiring dropped on ONE step.
    expect(GALLERY.match(/PREVIEW_URL: \$\{\{ steps\.deploy\.outputs\.url \}\}/g)).toHaveLength(2);
    // Same for the protection-bypass header secret wired into those two envs.
    // Line-anchored on purpose: the JOB-level env also sets the long-named
    // VERCEL_PROTECTION_BYPASS line, whose `_BYPASS:` substring would
    // otherwise inflate a bare substring count from 2 to 3.
    expect(GALLERY.match(/^\s+BYPASS: \$\{\{ secrets\.VERCEL_PROTECTION_BYPASS \}\}$/gm)).toHaveLength(2);
  });

  it('still runs the gallery capture against the live preview', () => {
    expect(GALLERY).toContain('Capture gallery (fails if any cell does not render the app shell)');
    // Literal string, not a regex: the line is `-- "${args[@]}"` and a regex
    // would need to escape the brackets (a character-class trap).
    expect(GALLERY).toContain('npm run capture:screenshots -- "${args[@]}"');
    expect(GALLERY).toContain('CHROME_PATH: ${{ steps.chrome.outputs.chrome-path }}');
  });

  it('still wires the Firebase env trio so the review-sheet cells re-render in CI', () => {
    // capture-gallery.mjs runs the shared verify-review-sheet.mjs driver when
    // the Firebase env is present; the job env must pass the trio through so
    // the print-all pair ships with the gallery on every run, and the project
    // id must stay pinned to freebuff2 (a copy-paste to the old project would
    // make the review sheet render against the wrong Firestore).
    expect(GALLERY).toContain('FIREBASE_WEB_API_KEY: ${{ secrets.FIREBASE_WEB_API_KEY }}');
    expect(GALLERY).toContain('FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}');
    expect(GALLERY).toContain('NEXT_PUBLIC_FIREBASE_PROJECT_ID: portfolio-app-freebuff2');
  });

  it('wires the full EXPECTED_LIVE_FLAGS set into the gallery job env', () => {
    // Same contract as the verify-deployed job: every flag the local gate
    // requires in the deployed store must be declared here, so the gallery
    // workflow (which captures the live feed via capture-deployments-feed.mjs
    // and fails loudly when the live badge is missing) stays locked to the
    // same set. A flag added to EXPECTED_LIVE_FLAGS without this wiring fails
    // below — CI can never silently drift from the gate's contract.
    expect(Object.keys(EXPECTED_LIVE_FLAGS).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(EXPECTED_LIVE_FLAGS)) {
      expect(GALLERY).toContain(`${key}: '${value}'`);
    }
  });

  it('still renders the onboarding docs to PNG for the artifact', () => {
    // Scoped to the step block (from the step name to the next step) so the
    // CHROME_PATH assertion can only be satisfied by THIS step, not the
    // pre-existing Capture step's identical env line. The wiring is
    // load-bearing: on the Linux runner the default /Applications/… fallback
    // in capture-docs.mjs does not exist, so losing it breaks CI silently.
    const stepStart = GALLERY.indexOf('Render onboarding docs to PNG');
    const upload = GALLERY.indexOf('Upload captured screenshots');
    const stepBlock = GALLERY.slice(stepStart, upload);
    expect(stepBlock.length).toBeGreaterThan(0);
    expect(stepBlock).toContain('npm run capture:docs');
    expect(stepBlock).toContain('CHROME_PATH: ${{ steps.chrome.outputs.chrome-path }}');
  });

  it('keeps the docs render UNGATED (no Vercel trio, so it ships when preview steps skip)', () => {
    // The docs render needs no secrets/URL; gating it on the env trio would
    // tie the onboarding visuals to the preview deploy and starve forks or
    // secret-less runs. Scoped to the step block so the trio count below is
    // unaffected and the step's own intent stays pinned.
    const stepStart = GALLERY.indexOf('Render onboarding docs to PNG');
    const upload = GALLERY.indexOf('Upload captured screenshots');
    const stepBlock = GALLERY.slice(stepStart, upload);
    expect(stepBlock.length).toBeGreaterThan(0);
    expect(stepBlock).not.toContain("env.VERCEL_TOKEN != ''");
    expect(stepBlock).not.toContain('steps.deploy.outputs.url');
    expect(stepBlock).not.toContain('VERCEL_PROTECTION_BYPASS');
  });

  it('keeps the run-safety envelope (concurrency, timeout, Node 22)', () => {
    // Dropping any of these would let gallery runs pile up on rapid pushes,
    // hang without a bound, or silently drift the runtime the CDP driver
    // depends on — so the envelope is part of the locked contract.
    expect(GALLERY).toContain('group: gallery-${{ github.ref }}');
    expect(GALLERY).toContain('cancel-in-progress: true');
    expect(GALLERY).toContain('timeout-minutes: 25');
    expect(GALLERY).toMatch(/node-version: 22/);
  });

  it('still uploads the captured screenshots as an artifact', () => {
    // Upload must run on always() (so a failed capture still ships its
    // screenshots for inspection) and must keep the ignore-no-files behavior
    // so a missing screenshots dir does not fail the run.
    expect(GALLERY).toContain('if: always()');
    expect(GALLERY).toMatch(/uses: actions\/upload-artifact@v6/);
    expect(GALLERY).toContain('name: gallery-screenshots');
    expect(GALLERY).toContain('path: screenshots/');
    expect(GALLERY).toContain('if-no-files-found: ignore');
  });
});

describe('.github/workflows/verify-deployed-hash.yml · deployment_status deployed-hash gate', () => {
  it('triggers on deployment_status and only on successful deploys with a sha', () => {
    expect(DEPLOYED_HASH).toMatch(/^on:\s*\n\s*deployment_status:/m);
    expect(DEPLOYED_HASH).toContain("github.event.deployment_status.state == 'success'");
    expect(DEPLOYED_HASH).toContain('github.event.deployment.sha !=');
  });

  it('still verifies the deployed commit matches the pushed head (--url + --expect)', () => {
    expect(DEPLOYED_HASH).toMatch(/node scripts\/verify-deployed-hash\.mjs/);
    expect(DEPLOYED_HASH).toContain('--url "${{ github.event.deployment_status.target_url }}"');
    expect(DEPLOYED_HASH).toContain('--expect "${{ github.event.deployment.sha }}"');
    expect(DEPLOYED_HASH).toContain("if: ${{ env.VERCEL_TOKEN != '' }}");
  });

  it('keeps the production alias-routing drift watch (--compare-url), scoped to THIS project\'s production label', () => {
    expect(DEPLOYED_HASH).toContain('--compare-url "https://portfolio-app-freebuff.vercel.app"');
    // Vercel labels environments "Production – <project-name>" (en-dash,
    // U+2013) ONLY when multiple projects are linked to one repo (the
    // disambiguation case — this repo used to have the leftover
    // reviewmaestro-reconstructed project); a single linked project gets the
    // bare "Production" label. The lock asserts the DUAL form — bare
    // 'Production' OR this project's exact suffixed label — so the gate fires
    // in BOTH regimes and never on the other project's deployments (a revert
    // to a bare `== 'Production'` or a bare 'Production' prefix fails here).
    const dualForm = "(github.event.deployment_status.environment == 'Production' || startsWith(github.event.deployment_status.environment, 'Production – portfolio-app-freebuff'))";
    expect(DEPLOYED_HASH).toContain(dualForm);
    expect(DEPLOYED_HASH).toContain("startsWith(github.event.deployment_status.environment, 'Production – portfolio-app-freebuff')");
    expect(DEPLOYED_HASH).not.toMatch(/startsWith\(github\.event\.deployment_status\.environment, 'Production – portfolio-app-freebuff'\) \}\}/);
  });

  it('wires the full EXPECTED_LIVE_FLAGS set into the deployed-hash job env', () => {
    // Same contract as the other three workflows: the deployed-store LIVE-flag
    // set must be declared in this deployment_status workflow too, so EVERY
    // workflow that fires per deploy is locked to the same set the local gate
    // asserts. A flag added to EXPECTED_LIVE_FLAGS without this wiring — or
    // dropped here while still required — fails below.
    expect(Object.keys(EXPECTED_LIVE_FLAGS).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(EXPECTED_LIVE_FLAGS)) {
      expect(DEPLOYED_HASH).toContain(`${key}: '${value}'`);
    }
  });

  it('machine-reproves the gate-stale teeth after every PRODUCTION deploy (verify-gate-stale-ci.mjs)', () => {
    // The wrapper runs the gate-stale proof (FAIL path + stale-guard) against
    // live from the pushed commit's PARENT after a successful production
    // deploy, so the stale-guard teeth are proven on the real runner — not
    // just via the npm one-liners. Production-only: the proof resolves the
    // canonical PRODUCTION alias, so on preview deployments (PR-head
    // checkout) the comparison would be meaningless. The wrapper itself is
    // skip-not-fail on the transient edge (alias promotion lag / API hiccup),
    // so only a proof that CAN reproduce is allowed to fail.
    expect(DEPLOYED_HASH).toContain('name: Verify gate-stale proof after deploy (teeth)');
    expect(DEPLOYED_HASH).toContain('run: node scripts/verify-gate-stale-ci.mjs');
    // Scoped to THIS project's production label — the same silent-skip bug
    // the alias-routing step had. The if must use the DUAL form (bare
    // 'Production' for the single-project regime this repo reverted to after
    // the leftover project was disconnected, OR the en-dash suffixed label
    // for the multi-project regime), never a bare == 'Production' prefix
    // that would fire on another project's events.
    expect(DEPLOYED_HASH).toContain("if: ${{ env.VERCEL_TOKEN != '' && (github.event.deployment_status.environment == 'Production' || startsWith(github.event.deployment_status.environment, 'Production – portfolio-app-freebuff')) }}");
    expect(DEPLOYED_HASH).not.toMatch(/startsWith\(github\.event\.deployment_status\.environment, 'Production – portfolio-app-freebuff'\) \}\}/);
    expect(DEPLOYED_HASH).toContain('loud SKIP');
  });
});

describe('.github/workflows/gallery-stability.yml · scheduled double-capture byte-stability', () => {
  it('triggers on a nightly schedule and workflow_dispatch', () => {
    // The determinism enforcement runs unattended on a cron (quiet hour,
    // away from push-time gallery runs) and stays manually dispatchable so a
    // suspected regression can be re-proven on demand.
    expect(GALLERY_STABILITY).toMatch(/^on:\s*\n\s*schedule:/m);
    expect(GALLERY_STABILITY).toContain("cron: '17 4 * * *'");
    expect(GALLERY_STABILITY).toContain('workflow_dispatch:');
  });

  it('still installs Chrome and wires CHROME_PATH to both captures', () => {
    expect(GALLERY_STABILITY).toMatch(/uses: browser-actions\/setup-chrome@v2/);
    expect(GALLERY_STABILITY).toMatch(/chrome-version: stable/);
    expect(GALLERY_STABILITY).toContain('CHROME_PATH: ${{ steps.chrome.outputs.chrome-path }}');
  });

  it('captures the SAME preview twice into distinct out dirs', () => {
    // The two captures must share one preview URL (deployed once, above) so
    // the route cells are byte-stable by construction — a second deploy step
    // would let a mid-run rebuild masquerade as determinism. The out dirs
    // must be distinct or run 2 would overwrite run 1 and the diff would
    // vacuously pass.
    expect(GALLERY_STABILITY).toContain('--out /tmp/gallery-stability-1');
    expect(GALLERY_STABILITY).toContain('--out /tmp/gallery-stability-2');
    expect(GALLERY_STABILITY.match(/npm run capture:screenshots -- "\$\{args\[@\]\}"/g)).toHaveLength(2);
    expect(GALLERY_STABILITY.indexOf('id: deploy')).toBeLessThan(GALLERY_STABILITY.indexOf('--out /tmp/gallery-stability-1'));
    expect(GALLERY_STABILITY.indexOf('--out /tmp/gallery-stability-1')).toBeLessThan(GALLERY_STABILITY.indexOf('--out /tmp/gallery-stability-2'));
  });

  it('runs the byte-diff gate AFTER both captures, referencing both dirs', () => {
    // The gate is the whole point of the workflow: it must run after the
    // second capture (index order) and must compare the two dirs. A future
    // edit that drops the gate — or points it at one dir — fails here.
    const a = GALLERY_STABILITY.indexOf('--out /tmp/gallery-stability-1');
    const b = GALLERY_STABILITY.indexOf('--out /tmp/gallery-stability-2');
    // Anchored on the `node …` invocation, not the bare script name: the
    // workflow's top comment references the script too, so a bare search
    // would match the prose at the top and the order assertion would pass
    // vacuously.
    const gate = GALLERY_STABILITY.indexOf('node scripts/verify-gallery-stability.mjs');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(b);
    expect(GALLERY_STABILITY).toContain('node scripts/verify-gallery-stability.mjs --a /tmp/gallery-stability-1 --b /tmp/gallery-stability-2');
  });

  it('gates the Deploy/Wait/Capture/diff steps on the Vercel env trio (5 steps)', () => {
    // Same skip-not-fail philosophy as gallery.yml, applied to every step that
    // needs the preview: Deploy, Wait, Capture 1, Capture 2, and the diff.
    // Counting occurrences (not a bare toContain) catches a gate dropped on
    // any ONE step — an ungated capture would silently hit the production
    // URL default and churn every live cell.
    expect(GALLERY_STABILITY.match(new RegExp(GALLERY_ENV_TRIO.replace(/[$\{\}]/g, '\\$&'), 'g'))).toHaveLength(5);
  });

  it('wires the Firebase env trio so the review-sheet + feed cells re-render', () => {
    // capture-gallery.mjs runs the shared review-sheet + deployments-feed
    // drivers when the Firebase env is present; without the trio those two
    // cells skip (NOTE) and the diff loses its coverage of them.
    expect(GALLERY_STABILITY).toContain('FIREBASE_WEB_API_KEY: ${{ secrets.FIREBASE_WEB_API_KEY }}');
    expect(GALLERY_STABILITY).toContain('FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}');
    expect(GALLERY_STABILITY).toContain('NEXT_PUBLIC_FIREBASE_PROJECT_ID: portfolio-app-freebuff2');
  });

  it('wires the full EXPECTED_LIVE_FLAGS set into the stability job env', () => {
    // Same contract as the other four workflows: the deployed-store LIVE-flag
    // set must be declared here so this scheduled workflow stays locked to
    // the same set the local gate asserts.
    expect(Object.keys(EXPECTED_LIVE_FLAGS).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(EXPECTED_LIVE_FLAGS)) {
      expect(GALLERY_STABILITY).toContain(`${key}: '${value}'`);
    }
  });

  it('keeps the run-safety envelope (concurrency, 45-minute budget, Node 22)', () => {
    // Two full gallery captures + preview deploy need more than the single
    // gallery job's 25-minute budget; a regression to a smaller timeout would
    // kill the run mid-capture and red the schedule.
    expect(GALLERY_STABILITY).toContain('group: gallery-stability');
    expect(GALLERY_STABILITY).toContain('cancel-in-progress: true');
    expect(GALLERY_STABILITY).toContain('timeout-minutes: 45');
    expect(GALLERY_STABILITY).toMatch(/node-version: 22/);
  });

  it('still uploads both captures for debugging when the diff fails', () => {
    // The upload must run on always() (so a failed diff still ships both
    // captures for pixel-level inspection) and must keep ignore-no-files.
    expect(GALLERY_STABILITY).toContain('if: always()');
    expect(GALLERY_STABILITY).toMatch(/uses: actions\/upload-artifact@v6/);
    expect(GALLERY_STABILITY).toContain('name: gallery-stability-captures');
    expect(GALLERY_STABILITY).toContain('if-no-files-found: ignore');
  });
});
