import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { classifyFeedPage, MIN_ROWS } from './capture-deployments-feed.mjs';

// ============================================================================
// scripts/capture-deployments-feed.test.ts — lock the live-feed classifier.
//
// capture-deployments-feed.mjs captures the LIVE /deployments page (App
// Hosting rows with health checks) for the gallery. Its pure classifier,
// classifyFeedPage, turns the page's innerText into a readiness verdict — the
// ONLY gate between the driver and capturing a demo-mode or half-rendered
// feed. This suite locks that gate so a future edit cannot weaken it into
// accepting sample data (the NEXT_PUBLIC_LIVE_DEPLOYMENTS-off regression the
// driver exists to catch), an empty grid, or a feed with no App Hosting
// rows.
//
// The live markers are deliberately tolerant of the headless font quirk that
// drops trailing letters ('App Hostin ' instead of 'App Hosting', 'Fireba e'
// instead of 'Firebase'): provider checks use a prefix, so both the full word
// and the rendered truncation count. The Firebase Hosting row is optional
// (only present when a Hosting release exists), so it is detected but not
// required for ready.
// ============================================================================

// A realistic ready page: live badge, metric grid (StatCards render
// UPPERCASE), the three App Hosting backend rows, and enough deployment
// cards. Each card carries one 'Open' link, so rows === count of 'Open'.
const READY_TEXT = [
  'Deployments',
  'Live health checks Deployments and statuses fetched from Firebase App Hosting; each URL is probed for its HTTP status and response time.',
  'TOTAL DEPLOYMENTS 3',
  'portfolio-app-freebuff App Hosting · production HEALTHY READY 200 · 251ms checked just now Open',
  'freebuff-car-app App Hosting · production HEALTHY READY 200 · 210ms checked just now Open',
  'cook-with-freebuff App Hosting · production HEALTHY READY 200 · 180ms checked just now Open',
].join(' ');

describe('classifyFeedPage', () => {
  it('declares a ready page with the live badge, metrics, App Hosting rows, and enough rows', () => {
    const v = classifyFeedPage(READY_TEXT);
    expect(v.ready).toBe(true);
    expect(v.live).toBe(true);
    expect(v.metrics).toBe(true);
    expect(v.apphosting).toBe(true);
    expect(v.rows).toBeGreaterThanOrEqual(MIN_ROWS);
  });

  it('tolerates the headless font quirk that drops trailing letters from provider labels', () => {
    // The captured page renders 'App Hostin ' (dropped 'g') in headless
    // Chrome; the classifier must still recognize the App Hosting provider.
    const quirk = READY_TEXT.replace('App Hosting ·', 'App Hostin ·');
    const v = classifyFeedPage(quirk);
    expect(v.apphosting).toBe(true);
    expect(v.ready).toBe(true);
  });

  it('never mistakes the page description for a provider row', () => {
    // The description line says "fetched from Firebase App Hosting" — a naive
    // includes() check would count that as an App Hosting row even on an
    // empty feed. Only a card line (provider + interpunct + environment) may
    // satisfy the provider checks.
    const descriptionOnly = READY_TEXT.replace(/[a-z0-9-]+ App Hosting · production HEALTHY READY 200 · \d+ms checked just now Open/g, '').replace('TOTAL DEPLOYMENTS 3', 'TOTAL DEPLOYMENTS 0');
    const v = classifyFeedPage(descriptionOnly);
    expect(v.apphosting).toBe(false);
    expect(v.ready).toBe(false);
  });

  it('never accepts demo-mode data (no live badge — the NEXT_PUBLIC_LIVE_DEPLOYMENTS-off regression)', () => {
    // The exact regression the driver exists to catch: the feed works
    // server-side but the client renders the demo description and a live flag
    // that is off. Without the 'Live health checks' badge the page must NOT be
    // ready, even when providers and rows are present.
    const demo = READY_TEXT
      .replace('Live health checks Deployments and statuses fetched from Firebase App Hosting; each URL is probed for its HTTP status and response time.', 'Every environment, health check, and rollout across all versions.')
      .replace('checked just now', 'deployed 2d ago');
    const v = classifyFeedPage(demo);
    expect(v.live).toBe(false);
    expect(v.ready).toBe(false);
  });

  it('requires the App Hosting provider — a feed with no App Hosting rows is not ready', () => {
    // Demo/sample data never renders 'App Hosting · production' cards (seed
    // fixtures use Vercel/Netlify/... providers), so an App-Hosting-less feed
    // can only be demo-mode or half-rendered.
    const noAppHosting = READY_TEXT.replace(/[a-z0-9-]+ App Hosting · production HEALTHY READY 200 · \d+ms checked just now Open/g, '').replace('TOTAL DEPLOYMENTS 3', 'TOTAL DEPLOYMENTS 0');
    expect(classifyFeedPage(noAppHosting).apphosting).toBe(false);
    expect(classifyFeedPage(noAppHosting).ready).toBe(false);
  });

  it('still detects a Firebase Hosting row when one is present (informational, not required)', () => {
    const withFirebase = READY_TEXT.replace('TOTAL DEPLOYMENTS 3', 'TOTAL DEPLOYMENTS 4') + ' portfolio-app-freebuff2 Firebase · production HEALTHY READY 200 · 3ms checked just now Open';
    expect(classifyFeedPage(withFirebase).firebase).toBe(true);
    expect(classifyFeedPage(withFirebase).ready).toBe(true);
    // The base fixture has no Firebase row — ready does not depend on it.
    expect(classifyFeedPage(READY_TEXT).firebase).toBe(false);
  });

  it('requires the metric grid — an empty page or missing StatCards is not ready', () => {
    const noMetrics = READY_TEXT.replace('TOTAL DEPLOYMENTS 3', '');
    expect(classifyFeedPage(noMetrics).metrics).toBe(false);
    expect(classifyFeedPage(noMetrics).ready).toBe(false);
  });

  it('requires at least MIN_ROWS deployment cards', () => {
    // Remove one actual card (one 'Open' link) AND the metric count, so the
    // rows count really drops below the bar — the metric text alone must not
    // change the verdict.
    const thin = READY_TEXT
      .replace('TOTAL DEPLOYMENTS 3', `TOTAL DEPLOYMENTS ${MIN_ROWS - 1}`)
      .replace(/[a-z0-9-]+ App Hosting · production HEALTHY READY 200 · \d+ms checked just now Open/, '');
    const v = classifyFeedPage(thin);
    expect(v.rows).toBeLessThan(MIN_ROWS);
    expect(v.ready).toBe(false);
  });

  it('returns a non-ready verdict for empty or null text', () => {
    expect(classifyFeedPage('').ready).toBe(false);
    expect(classifyFeedPage(null).ready).toBe(false);
    expect(classifyFeedPage(undefined).ready).toBe(false);
  });

  it('locks MIN_ROWS to the currently monitored App Hosting backend count (3)', () => {
    // The constant is the contract with the live feed: the gallery cell must
    // show the full real grid, so a change to the monitored backend set must
    // update this number deliberately, and the classifier test with it.
    expect(MIN_ROWS).toBe(3);
  });
});

// ============================================================================
// headless Chrome spawn flags — the same Linux-runner lock capture-gallery
// and verify-review-sheet carry. The driver is importable (it exports the
// classifier behind a main guard), so the source is read from disk here and
// the spawn args block extracted between `spawn(CHROME, [` and `], { stdio:
// 'ignore' })`.
// ============================================================================

const feedDriver = readFileSync('scripts/capture-deployments-feed.mjs', 'utf8');

describe('scripts/capture-deployments-feed.mjs · headless Chrome spawn flags', () => {
  const chromeArgsBlock = feedDriver.slice(
    feedDriver.indexOf('spawn(CHROME, ['),
    feedDriver.indexOf("], { stdio: 'ignore' })"),
  );

  it('has a non-empty Chrome spawn args block (spawn call intact)', () => {
    expect(chromeArgsBlock.length).toBeGreaterThan(0);
    expect(feedDriver).toContain('spawn(CHROME, [');
    expect(feedDriver).toContain("], { stdio: 'ignore' })");
  });

  it('passes --no-sandbox and --disable-dev-shm-usage as real array entries (not comment prose)', () => {
    // The Linux CI runner requires both flags; comment-stripping proves they
    // are ACTUAL args, not prose mentioned in an explanatory comment.
    const argsWithoutComments = chromeArgsBlock
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(argsWithoutComments).toContain("'--no-sandbox'");
    expect(argsWithoutComments).toContain("'--disable-dev-shm-usage'");
    expect(argsWithoutComments).toMatch(/'--no-sandbox',/);
    expect(argsWithoutComments).toMatch(/'--disable-dev-shm-usage',/);
  });

  it('keeps the flags in the single capture Chrome spawn before --remote-debugging-port', () => {
    const noSandboxIdx = chromeArgsBlock.indexOf("'--no-sandbox'");
    const shmIdx = chromeArgsBlock.indexOf("'--disable-dev-shm-usage'");
    const portIdx = chromeArgsBlock.indexOf('--remote-debugging-port=');
    expect(noSandboxIdx).toBeGreaterThan(-1);
    expect(shmIdx).toBeGreaterThan(-1);
    expect(portIdx).toBeGreaterThan(shmIdx);
    expect(portIdx).toBeGreaterThan(noSandboxIdx);
    expect(feedDriver.match(/spawn\(CHROME, \[/g)).toHaveLength(1);
  });
});

describe('scripts/capture-deployments-feed.mjs · per-run Chrome profile (--user-data-dir)', () => {
  // Same spawn-args slice the flags describe uses — scoped here because the
  // other describe's const is closed over its own block.
  const profileArgsBlock = feedDriver.slice(
    feedDriver.indexOf('spawn(CHROME, ['),
    feedDriver.indexOf("], { stdio: 'ignore' })"),
  );

  it('defines USER_DATA_DIR as a unique per-run path (pid + timestamp, never fixed)', () => {
    // A FIXED profile dir would make two runs on the same machine share one
    // Chrome profile and its SingletonLock — the second run can't start or
    // reuses stale state. The shared per-run pattern (pid + Date.now) makes
    // every launch isolated.
    expect(feedDriver).toMatch(/const USER_DATA_DIR = `\/tmp\/deployments-feed-chrome-\$\{process\.pid\}-\$\{Date\.now\(\)\}`/);
    // The fixed-profile literal must not survive anywhere in the driver.
    expect(feedDriver).not.toContain("'--user-data-dir=/tmp/");
    expect(feedDriver).not.toContain('--user-data-dir=/tmp/deployments-feed-chrome');
  });

  it('passes the per-run profile to the Chrome spawn (template-literal reference)', () => {
    // The constant must actually reach the spawn as the --user-data-dir
    // ARGUMENT — a constant defined but never used would silently keep the
    // driver on whatever path it falls back to.
    expect(profileArgsBlock).toContain('`--user-data-dir=${USER_DATA_DIR}`');
    expect(profileArgsBlock).toMatch(/--user-data-dir=\$\{USER_DATA_DIR\}/);
  });

  it('cleans the per-run profile up on every signal and at end of main', () => {
    // A per-run dir that is never removed still leaks /tmp profiles. Unlike
    // capture-gallery, this driver's exit handler only kills Chrome — the
    // profile is removed on every interrupt signal (dropProfile) AND
    // explicitly at end of main, so the rmSync body must appear twice (the
    // dropProfile definition + the end-of-main call), never once.
    expect(feedDriver).toMatch(/const dropProfile = \(\) => \{ try \{ rmSync\(USER_DATA_DIR, \{ recursive: true, force: true \}\);/);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      expect(feedDriver).toContain(`process.on(sig, () => { killChrome(); dropProfile(); process.exit(130); })`);
    }
    const cleanupCalls = feedDriver.split('try { rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }').length - 1;
    expect(cleanupCalls).toBe(2);
  });
});
