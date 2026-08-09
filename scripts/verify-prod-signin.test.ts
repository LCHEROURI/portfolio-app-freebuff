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
      expect(script).toContain(`process.on(sig, () => { killChrome(); dropProfile(); void cleanup().finally(() => process.exit(130)); })`);
    }
    const cleanupCalls = script.split('try { rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }').length - 1;
    expect(cleanupCalls).toBe(2);
  });
});

describe('scripts/verify-prod-signin.mjs · awaited probe cleanup on every exit path', () => {
  // The Aug-2026 leak: cleanup ran through `process.on('exit', () => void
  // cleanup())` — exit handlers CANNOT await, so the DELETE fetch raced
  // process teardown and every sign-in probe leaked its projects/probe-*
  // doc into Firestore (~350 leaked docs across ~298 uids). The fix routes
  // every post-mint exit through exitWith, which awaits cleanup() before
  // process.exit. This describe locks that contract so the fire-and-forget
  // pattern cannot silently return.

  it('exitWith awaits cleanup() before process.exit', () => {
    const exitWith = script.slice(
      script.indexOf('const exitWith = async (code) => {'),
      script.indexOf('// ── 2. Launch headless Chrome'),
    );
    expect(exitWith).toContain('await cleanup();');
    expect(exitWith).toContain('process.exit(code);');
    // Order matters: the await must come BEFORE the exit, or the deletes
    // still race.
    expect(exitWith.indexOf('await cleanup();')).toBeLessThan(exitWith.indexOf('process.exit(code);'));
  });

  it('bans the fire-and-forget exit-handler cleanup pattern', () => {
    // Strip `//` comment lines first — the driver's header documents the OLD
    // buggy pattern verbatim, so the ban must prove no live CODE carries it
    // (same comment-stripping discipline as the spawn-flags describe above).
    const codeOnly = script
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(codeOnly).not.toContain('() => void cleanup()');
    expect(codeOnly).not.toContain("process.on('exit', () => void");
    // The only remaining process.on('exit') is the synchronous killChrome
    // hook — killing a child process is fine in an exit handler; awaiting a
    // fetch is not.
    expect(script).toContain("process.on('exit', killChrome);");
  });

  it('routes every post-mint exit path through awaited exitWith (5 call sites)', () => {
    // Chrome-DevTools timeout, AuthGate never visible, form-fill failure,
    // shell never rendered, and the normal completion — all five must await
    // exitWith so the probe doc + throwaway user are deleted on each. A new
    // bare `process.exit` after cleanup is defined would leak again.
    const exitWithCalls = script.split('await exitWith(').length - 1;
    expect(exitWithCalls).toBe(5);
    // The two plain process.exit(1) guards (no API key / mint failure) must
    // stay BEFORE cleanup is defined — on those paths there is no user or
    // probe doc to delete, and an exitWith call there would crash on the
    // undefined cleanup reference.
    const cleanupDefIdx = script.indexOf('const cleanup = async () => {');
    const firstEarlyExit = script.indexOf('process.exit(1);');
    const secondEarlyExit = script.indexOf('process.exit(1);', firstEarlyExit + 1);
    expect(firstEarlyExit).toBeGreaterThan(-1);
    expect(secondEarlyExit).toBeGreaterThan(firstEarlyExit);
    expect(secondEarlyExit).toBeLessThan(cleanupDefIdx);
    // No bare process.exit can appear between cleanup's definition and the
    // end of the file (all of those would bypass the awaited deletes).
    const tail = script.slice(cleanupDefIdx);
    const bareExits = tail.split('process.exit(').length - 1;
    // exitWith's own process.exit(code) + the signal-handler exit(130).
    expect(bareExits).toBe(2);
  });

  it('signal handlers wait for cleanup before exiting (no void-race)', () => {
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      expect(script).toContain(`process.on(sig, () => { killChrome(); dropProfile(); void cleanup().finally(() => process.exit(130)); })`);
    }
    // The .finally on the cleanup promise means process.exit(130) fires only
    // AFTER the DELETE + accounts:delete fetches settle — the awaited
    // counterpart of exitWith for the signal path.
  });

  it('keeps the cleanup idempotency guard (first call wins, later no-ops)', () => {
    // Exit paths can each fire cleanup as the process unwinds; without the
    // guard, a second call would DELETE a doc twice (harmless) but also
    // re-run accounts:delete with a consumed token (noisy failure). The
    // guard makes concurrent exit paths safe.
    expect(script).toContain('let cleanupRan = false;');
    expect(script).toContain('if (cleanupRan) return;');
    expect(script).toContain('cleanupRan = true;');
  });
});
