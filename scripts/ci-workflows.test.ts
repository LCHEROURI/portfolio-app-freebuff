import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

  it('still runs the deployed Firestore rules step, gated on FIREBASE_WEB_API_KEY, pinned to freebuff2', () => {
    expect(verifyDeployedBlock).toMatch(/run: node scripts\/verify-firestore-rules\.mjs/);
    expect(verifyDeployedBlock).toContain("if: ${{ env.FIREBASE_WEB_API_KEY != '' }}");
    expect(verifyDeployedBlock).toContain('FIREBASE_WEB_API_KEY: ${{ secrets.FIREBASE_WEB_API_KEY }}');
    // The project-id pin is part of the rules gate: the rules verifier must
    // always probe the freebuff2 project, never a bare freebuff that a
    // copy-paste could reintroduce.
    expect(verifyDeployedBlock).toContain('NEXT_PUBLIC_FIREBASE_PROJECT_ID: portfolio-app-freebuff2');
  });

  it('still runs the Google sign-in IdP config step, gated on FIREBASE_WEB_API_KEY', () => {
    expect(verifyDeployedBlock).toMatch(/run: node scripts\/verify-google-idp\.mjs/);
    expect(verifyDeployedBlock).toContain("if: ${{ env.FIREBASE_WEB_API_KEY != '' }}");
    expect(verifyDeployedBlock).toContain('FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}');
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
    expect(GALLERY).toMatch(/npx --yes vercel deploy --prebuilt --yes --token=/);
    // The env trio gates THREE steps (Deploy, Wait, Capture); asserting the
    // count keeps a drop on any one step from passing via another's copy.
    expect(GALLERY.match(new RegExp(GALLERY_ENV_TRIO.replace(/[$\{\}]/g, '\\$&'), 'g'))).toHaveLength(3);
    expect(GALLERY).toContain('VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}');
    expect(GALLERY).toContain('VERCEL_PROTECTION_BYPASS: ${{ secrets.VERCEL_PROTECTION_BYPASS }}');
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

  it('keeps the production alias-routing drift watch (--compare-url)', () => {
    expect(DEPLOYED_HASH).toContain('--compare-url "https://portfolio-app-freebuff.vercel.app"');
    expect(DEPLOYED_HASH).toContain("github.event.deployment_status.environment == 'Production'");
  });
});
