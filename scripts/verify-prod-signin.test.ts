import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/verify-prod-signin.test.ts — lock the headless Chrome spawn flags
// in the production sign-in verifier.
//
// verify-prod-signin.mjs drives the DEPLOYED app in headless Chrome (CDP):
// mints a throwaway Identity Toolkit user, signs in through the real gate,
// and asserts the Command Center shell renders + Firestore sync works. On the
// Linux CI runner the spawn MUST carry --no-sandbox + --disable-dev-shm-usage
// or Chrome's sandbox cannot initialize inside the container and DevTools
// never comes up — the same failure that broke every gallery run before
// 2a966b8. This suite locks those flags structurally (same pattern as
// capture-gallery.test.ts / verify-review-sheet.test.ts / capture-deployments-
// feed.test.ts): the flags must be REAL comma-anchored array entries in the
// single capture Chrome spawn, not prose in a comment.
// ============================================================================

const SCRIPT_PATH = 'scripts/verify-prod-signin.mjs';
const script = readFileSync(SCRIPT_PATH, 'utf8');

// The Chrome spawn args live between `spawn(CHROME, [` and `], { stdio:
// 'ignore' })`. Scoping to that block keeps every assertion honest: a flag
// mentioned only in a comment anywhere else in the driver cannot satisfy them
// (comment lines inside the array are stripped below).
const chromeArgsBlock = script.slice(
  script.indexOf('spawn(CHROME, ['),
  script.indexOf("], { stdio: 'ignore' })"),
);

describe('scripts/verify-prod-signin.mjs · headless Chrome spawn flags', () => {
  it('has a non-empty Chrome spawn args block (spawn call intact)', () => {
    // A non-empty block guard: if the spawn call is ever rewritten so the
    // slice resolves to '', every assertion below would fail confusingly.
    expect(chromeArgsBlock.length).toBeGreaterThan(0);
    expect(script).toContain('spawn(CHROME, [');
    expect(script).toContain("], { stdio: 'ignore' })");
  });

  it('passes --no-sandbox and --disable-dev-shm-usage as real array entries (not comment prose)', () => {
    // The spawn carries an explanatory comment about the sandbox; stripping
    // `//` comment lines proves the flags are ACTUAL args, not prose — a
    // future edit that moves them into the comment while dropping them from
    // the array fails here.
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

describe('scripts/verify-prod-signin.mjs · per-run Chrome profile (--user-data-dir)', () => {
  // Same spawn-args slice the flags describe uses — scoped here to keep the
  // block self-contained (the module-level chromeArgsBlock stays with the
  // flags describe).
  const profileArgsBlock = script.slice(
    script.indexOf('spawn(CHROME, ['),
    script.indexOf("], { stdio: 'ignore' })"),
  );

  it('defines USER_DATA_DIR as a unique per-run path (pid + timestamp, never fixed)', () => {
    // A FIXED profile dir would make two runs on the same machine share one
    // Chrome profile and its SingletonLock — the second run can't start or
    // reuses stale state. The shared per-run pattern (pid + Date.now) makes
    // every launch isolated.
    expect(script).toMatch(/const USER_DATA_DIR = `\/tmp\/prod-signin-chrome-\$\{process\.pid\}-\$\{Date\.now\(\)\}`/);
    // The fixed-profile literal must not survive anywhere in the driver.
    expect(script).not.toContain("'--user-data-dir=/tmp/");
    expect(script).not.toContain('--user-data-dir=/tmp/prod-signin-chrome');
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
