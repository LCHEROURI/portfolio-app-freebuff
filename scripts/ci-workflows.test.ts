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
const GALLERY = readFileSync('.github/workflows/gallery.yml', 'utf8');
const GALLERY_STABILITY = readFileSync('.github/workflows/gallery-stability.yml', 'utf8');

// The gallery capture runs against a locally built demo-mode server (no
// Vercel preview since the decoupling), so no VERCEL_* env-trio gating
// exists anymore — the suite asserts the capture flow directly.
// The build must precede the server start and the wait/capture steps;
// exactly one server start (single `next start`) must survive.
const DEMO_SERVER_START = 'npx next start -p 4399';
const DEMO_SERVER_URL = 'http://127.0.0.1:4399';

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

  it('builds a demo-mode production bundle and starts a local server instead of a Vercel preview', () => {
    // The gallery captures from a LOCALLY built demo-mode server (the app
    // builds and runs with zero env vars — proven on the runner), so no
    // Vercel deploy step, no VERCEL_* secrets, and no protection-bypass
    // header may exist anywhere in the workflow.
    expect(GALLERY).toContain('Build demo-mode production bundle');
    expect(GALLERY).toContain('run: npm run build');
    expect(GALLERY).toContain('id: serve');
    // Exactly one server start (a second `next start` would race on 4399).
    expect(GALLERY.match(new RegExp(DEMO_SERVER_START.replace(/[$\{\}]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(GALLERY).not.toContain('VERCEL_TOKEN');
    expect(GALLERY).not.toContain('VERCEL_PROTECTION_BYPASS');
    // Build must precede the server start (the server serves the fresh
    // bundle, not a stale one from a previous run).
    expect(GALLERY.indexOf('run: npm run build')).toBeLessThan(GALLERY.indexOf(DEMO_SERVER_START));
  });

  it('keeps the workflow free of any Vercel reference', () => {
    // Stronger than the old remote-build lock: since the decoupling the
    // capture path needs nothing from Vercel, so even prose references are
    // banned — a reintroduced `vercel` invocation or bypass header fails
    // here before it can red the gallery again.
    expect(GALLERY).not.toMatch(/vercel/i);
  });

  it('waits for the local server to answer HTTP 200 before capturing', () => {
    // The readiness loop must exist and must probe the local demo server on
    // the command-center route before any capture begins.
    expect(GALLERY).toContain('Wait for server to answer HTTP 200');
    expect(GALLERY).toContain(`${DEMO_SERVER_URL}/command-center`);
    expect(GALLERY).toContain('Demo server did not answer HTTP 200 within 300s.');
    // The capture must target the local server URL.
    expect(GALLERY).toContain(`capture:screenshots -- --url ${DEMO_SERVER_URL}`);
  });

  it('still runs the gallery capture against the local demo server', () => {
    expect(GALLERY).toContain('Capture gallery (fails if any cell does not render the app shell)');
    expect(GALLERY).toContain(`capture:screenshots -- --url ${DEMO_SERVER_URL}`);
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

  it('keeps the docs render UNGATED (no secrets, so it ships even when capture fails)', () => {
    // The docs render needs no secrets/URL; gating it would starve forks or
    // secret-less runs. Scoped to the step block so the step's own intent
    // stays pinned.
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

  it('builds a demo-mode bundle and starts ONE local server both captures share', () => {
    // No Vercel preview anymore: the build precedes a single `next start`,
    // and both captures hit the same local URL so the route cells are
    // byte-stable by construction — a second server would race on 4399 and
    // could serve different content between the two captures.
    expect(GALLERY_STABILITY).toContain('Build demo-mode production bundle');
    expect(GALLERY_STABILITY).toContain('run: npm run build');
    expect(GALLERY_STABILITY).toContain('id: serve');
    expect(GALLERY_STABILITY.match(new RegExp(DEMO_SERVER_START.replace(/[$\{\}]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(GALLERY_STABILITY).not.toContain('VERCEL_TOKEN');
    // Build must precede the server start and both captures.
    const buildIdx = GALLERY_STABILITY.indexOf('run: npm run build');
    const startIdx = GALLERY_STABILITY.indexOf(DEMO_SERVER_START);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeGreaterThan(buildIdx);
  });

  it('captures the SAME local server twice into distinct out dirs', () => {
    // The two captures must share one server URL (started once, above) so
    // the route cells are byte-stable by construction — a second start step
    // would let a mid-run rebuild masquerade as determinism. The out dirs
    // must be distinct or run 2 would overwrite run 1 and the diff would
    // vacuously pass.
    expect(GALLERY_STABILITY).toContain('--out /tmp/gallery-stability-1');
    expect(GALLERY_STABILITY).toContain('--out /tmp/gallery-stability-2');
    expect(GALLERY_STABILITY.match(/npm run capture:screenshots -- --url http:\/\/127\.0\.0\.1:4399 --out \/tmp\/gallery-stability-/g)).toHaveLength(2);
    expect(GALLERY_STABILITY.indexOf('id: serve')).toBeLessThan(GALLERY_STABILITY.indexOf('--out /tmp/gallery-stability-1'));
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

  it('keeps the stability workflow free of any Vercel reference and wired to the local server', () => {
    // The capture path needs nothing from Vercel since the decoupling: no
    // VERCEL_* secret may exist anywhere, the wait loop must probe the local
    // server, and both captures must target it.
    expect(GALLERY_STABILITY).not.toMatch(/vercel/i);
    expect(GALLERY_STABILITY).toContain('Wait for server to answer HTTP 200');
    expect(GALLERY_STABILITY).toContain(`${DEMO_SERVER_URL}/command-center`);
    expect(GALLERY_STABILITY).toContain('Demo server did not answer HTTP 200 within 300s.');
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
