import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/verify-review-sheet.test.ts — lock the deterministic capture +
// --check byte-gate contract inside scripts/verify-review-sheet.mjs.
//
// The review-sheet pair (screenshots/review-sheet-*.png) used to drift run to
// run because the AI winner-recommendation note text is non-deterministic.
// This suite locks the mechanism that makes the pair byte-stable — CDP Fetch
// interception that pins BOTH variable fields (note + winner) — plus the
// --check mode that byte-compares the captured pair against the committed
// PNGs (the same gate contract capture-docs.mjs --check gives the docs PNGs).
// Reads the REAL script from disk (never a fixture): a future edit that
// weakens the interception (so notes drift again), drops the winner pin, or
// turns --check into a silent no-op fails here instead of letting the byte
// gate masquerade as verification.
// ============================================================================

const SCRIPT_PATH = 'scripts/verify-review-sheet.mjs';
const script = readFileSync(SCRIPT_PATH, 'utf8');

describe('scripts/verify-review-sheet.mjs · deterministic capture mode', () => {
  it('defines the REVIEW_SHEET_DETERMINISTIC flag and a fixed fixture note', () => {
    expect(script).toContain("process.env.REVIEW_SHEET_DETERMINISTIC === '1'");
    expect(script).toContain("const FIXTURE_NOTE =");
  });

  it('--check implies deterministic mode (the byte gate cannot work without it)', () => {
    expect(script).toContain('const DETERMINISTIC = isCheck ||');
  });

  it('enables CDP Fetch interception scoped to the recommend-winner API only', () => {
    // The interception must target exactly the AI route that carries the note;
    // a broader pattern would pause unrelated requests and risk hanging the run.
    expect(script).toContain("urlPattern: '*://*/*api/ai/recommend-winner*'");
    expect(script).toContain("requestStage: 'Response'");
  });

  it('pins the note to the fixture string in the fulfilled response', () => {
    expect(script).toContain('json.recommendation.note = FIXTURE_NOTE;');
    expect(script).toContain("main.send('Fetch.fulfillRequest'");
    // The response must be fulfilled (not just continued) so the rewritten
    // body actually reaches the page's JS.
    expect(script).toContain("name: 'content-type', value: 'application/json'");
  });

  it('pins the winner deterministically from the request candidates (top overallScore)', () => {
    // The note alone is not enough: the "Recommended: X Build" line comes from
    // recommendedVersionId, which the AI picks non-deterministically. The pin
    // must use the request's own candidates (the page's fallback choice).
    expect(script).toContain('Fetch.getRequestPostData');
    expect(script).toContain('json.recommendation.recommendedVersionId = top.versionId;');
    expect(script).toContain('c.overallScore > best.overallScore');
  });

  it('never hangs the run when interception fails (continues the request)', () => {
    expect(script).toContain('Fetch.continueRequest');
  });

  it('retries the sign-in submit once on a transient network failure', () => {
    // Firebase sign-in can fail with auth/network-request-failed on the first
    // request after idle; without the retry the byte gate (and the structural
    // gate) would fail whole runs on a network blip. The retry must re-fill
    // the form (a failed attempt may clear it) and fire ONCE, not loop.
    expect(script).toContain('signInRetried = false;');
    expect(script).toContain('retrying the submit once (transient network)');
    expect(script).toContain('signInRetried = true;');
  });
});

describe('scripts/verify-review-sheet.mjs · --check byte gate', () => {
  it('parses a --check flag distinct from the plain capture', () => {
    expect(script).toContain("args.includes('--check')");
  });

  it('byte-compares the captured pair against the committed screenshots/ PNGs', () => {
    expect(script).toContain('review-sheet-panels.png');
    expect(script).toContain('review-sheet-preview.png');
    expect(script).toContain('.equals(');
    expect(script).toContain('WOULD CHANGE (the deployed app altered the review-sheet visuals)');
  });

  it('exits 1 with re-capture-and-commit guidance when any PNG would change', () => {
    expect(script).toContain('review-sheet byte gate FAILED');
    expect(script).toContain("run 'npm run capture:screenshots'");
    expect(script).toContain('process.exit(1)');
  });

  it('SKIPS (exit 0, never fails) when there is no committed baseline to compare', () => {
    expect(script).toContain('no committed baseline PNGs in screenshots/');
    expect(script).toContain('process.exit(0)');
  });

  it('prints a distinct PASS message when the committed pair matches today\'s capture', () => {
    expect(script).toContain('review-sheet byte gate PASS');
  });
});

describe('scripts/verify-review-sheet.mjs · theme-stable capture (?theme=dark)', () => {
  // The byte gate's panels capture must be OS-independent: --headless=new
  // follows the machine's prefers-color-scheme, so a developer's macOS
  // appearance switch (Auto mode) silently flips the captured theme and
  // breaks the committed DARK PNGs — the exact failure that hit the
  // 9c18fd2→8728e2c push (byte gate passed at 12:30, failed at 12:45 when the
  // Mac auto-switched Dark→Light). The app's own ?theme=dark override pins
  // the render byte-for-byte regardless of the machine's appearance.
  it('navigates to /model-comparison with the app-native ?theme=dark override', () => {
    expect(script).toContain('`${APP}/model-comparison?theme=dark`');
  });

  it('every Page.navigate targeting model-comparison carries the override', () => {
    const navs = [...script.matchAll(/Page\.navigate[\s\S]{0,60}?url: `[^`]*model-comparison[^`]*`/g)].map((m) => m[0]);
    expect(navs.length).toBeGreaterThan(0);
    for (const nav of navs) expect(nav).toContain('?theme=dark');
  });

  it('never navigates to a bare /model-comparison (the OS-theme dependence must not return)', () => {
    expect(script).not.toMatch(/\$\{APP\}\/model-comparison`/);
  });
});

describe('scripts/verify-review-sheet.mjs · headless Chrome spawn flags', () => {
  // The Chrome spawn args live between `spawn(CHROME, [` and `], { stdio:
  // 'ignore' })`. Scoping to that block keeps every assertion honest: a flag
  // mentioned only in a comment anywhere else in the driver cannot satisfy
  // them (comment lines inside the array are stripped below).
  const chromeArgsBlock = script.slice(
    script.indexOf('spawn(CHROME, ['),
    script.indexOf("], { stdio: 'ignore' })"),
  );

  it('has a non-empty Chrome spawn args block (spawn call intact)', () => {
    // A non-empty block guard: if the spawn call is ever rewritten so the
    // slice resolves to '', every assertion below would fail confusingly.
    expect(chromeArgsBlock.length).toBeGreaterThan(0);
    expect(script).toContain('spawn(CHROME, [');
    expect(script).toContain("], { stdio: 'ignore' })");
  });

  it('passes --no-sandbox and --disable-dev-shm-usage as real array entries (not comment prose)', () => {
    // The Linux CI runner requires both flags: without --no-sandbox Chrome's
    // sandbox cannot initialize inside the container, and without
    // --disable-dev-shm-usage the shared /dev/shm runs out — either way
    // DevTools never comes up and the driver dies. Stripping `//` comment
    // lines proves the flags are ACTUAL args, not prose.
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
    // The flags must live in THE Chrome spawn this driver uses, not a
    // second/vestigial spawn — asserting they appear before the
    // --remote-debugging-port element proves they are part of the real
    // capture Chrome, and the spawn count of one catches a duplicated spawn
    // that could smuggle a missing flag set.
    const noSandboxIdx = chromeArgsBlock.indexOf("'--no-sandbox'");
    const shmIdx = chromeArgsBlock.indexOf("'--disable-dev-shm-usage'");
    const portIdx = chromeArgsBlock.indexOf('--remote-debugging-port=');
    expect(noSandboxIdx).toBeGreaterThan(-1);
    expect(shmIdx).toBeGreaterThan(-1);
    expect(portIdx).toBeGreaterThan(shmIdx);
    expect(portIdx).toBeGreaterThan(noSandboxIdx);
    expect(script.match(/spawn\(CHROME, \[/g)).toHaveLength(1);
  });
});

describe('scripts/verify-review-sheet.mjs · per-run Chrome profile (--user-data-dir)', () => {
  // Same spawn-args slice the flags describe uses — scoped here because the
  // other describe's const is closed over its own block.
  const profileArgsBlock = script.slice(
    script.indexOf('spawn(CHROME, ['),
    script.indexOf("], { stdio: 'ignore' })"),
  );

  it('defines USER_DATA_DIR as a unique per-run path (pid + timestamp, never fixed)', () => {
    // A FIXED profile dir would make two runs on the same machine share one
    // Chrome profile and its SingletonLock — the second run can't start or
    // reuses stale state. The shared per-run pattern (pid + Date.now) makes
    // every launch isolated.
    expect(script).toMatch(/const USER_DATA_DIR = `\/tmp\/review-sheet-chrome-\$\{process\.pid\}-\$\{Date\.now\(\)\}`/);
    // The fixed-profile literal must not survive anywhere in the driver.
    expect(script).not.toContain("'--user-data-dir=/tmp/");
    expect(script).not.toContain('--user-data-dir=/tmp/review-sheet-chrome');
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
    expect(script).toMatch(/const dropProfile = \(\) => \{ try \{ rmSync\(USER_DATA_DIR, \{ recursive: true, force: true \}\);/);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      expect(script).toContain(`process.on(sig, () => { killChrome(); dropProfile(); process.exit(130); })`);
    }
    const cleanupCalls = script.split('try { rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }').length - 1;
    expect(cleanupCalls).toBe(2);
  });
});
