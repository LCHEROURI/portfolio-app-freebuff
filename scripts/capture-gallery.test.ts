import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/capture-gallery.test.ts — lock the review-sheet AND deployments-feed
// steps inside the gallery capture driver, plus the headless Chrome spawn
// flags the Linux CI runner requires.
//
// capture-gallery.mjs re-renders the two Model Comparison review-sheet PNGs
// (review-sheet-panels.png / review-sheet-preview.png) and the live
// deployments-feed PNG (deployments-feed.png) with every gallery run by
// spawning the SHARED drivers (verify-review-sheet.mjs for the print-all pair,
// capture-deployments-feed.mjs for the feed) and copying their outputs into
// the gallery under stable names. The gallery.yml CI wiring for this is
// already locked by ci-workflows.test.ts; this test locks the DRIVER side, so
// a future edit that silently drops either step from capture-gallery.mjs fails
// here instead of shipping a gallery whose cells quietly stop updating.
// It also locks --no-sandbox + --disable-dev-shm-usage in the Chrome spawn:
// without them Chrome's sandbox cannot initialize inside the Actions Linux
// container and DevTools never comes up ('Chrome DevTools did not come up'),
// which failed every gallery run before 2a966b8.
//
// Scope discipline (mirroring ci-workflows.test.ts): the NOTE-vs-SKIP and
// spawn assertions are scoped to each step's BLOCK (from the section header to
// the next section header), NOT the whole file — the route loop legitimately
// prints `SKIP <name>: not the app shell` for failed cells, which must never
// satisfy a "the step skip uses NOTE" assertion.
// ============================================================================

const DRIVER = readFileSync('scripts/capture-gallery.mjs', 'utf8');

// The review-sheet block: everything between the section header and the HTML
// contact-sheet header. Scoping here keeps every assertion honest — a NOTE /
// spawn / copyFile line can only match inside this step.
const reviewSheetBlock = DRIVER.slice(
  DRIVER.indexOf('// ── Review-sheet cells (Model Comparison print-all)'),
  DRIVER.indexOf('// ── Deployments feed cell'),
);
// The deployments-feed block: from its section header to the HTML
// contact-sheet header. Scoping here keeps every assertion honest — a NOTE /
// spawn / copyFile line can only match inside this step.
const feedBlock = DRIVER.slice(
  DRIVER.indexOf('// ── Deployments feed cell'),
  DRIVER.indexOf('// ── HTML contact sheet'),
);

describe('scripts/capture-gallery.mjs · review-sheet re-render step', () => {
  it('has a non-empty review-sheet block (section headers intact)', () => {
    // A non-empty block guard: if the section headers are ever renamed so the
    // slice resolves to '', every toContain below would fail confusingly.
    expect(reviewSheetBlock.length).toBeGreaterThan(0);
    expect(DRIVER).toContain('// ── Review-sheet cells (Model Comparison print-all)');
    expect(DRIVER).toContain('// ── HTML contact sheet');
  });

  it('spawns the shared verify-review-sheet.mjs driver (never a duplicated CDP flow)', () => {
    // The review-sheet pair needs a signed-in owner with seeded evaluations
    // plus two live AI round-trips, which the demo-mode route capture cannot
    // produce — so the step must reuse the gate driver, not re-drive Chrome
    // itself. The spawn must pass --app (production default, overridable) and
    // --out (the temp dir the outputs are copied from).
    expect(reviewSheetBlock).toMatch(/spawn\('node', \['scripts\/verify-review-sheet\.mjs', '--app', reviewSheetAppArg, '--out', tmp\]/);
    // The driver's env must flow through so CI job secrets reach it.
    expect(reviewSheetBlock).toContain("cwd: process.cwd(), stdio: 'inherit', env: process.env");
  });

  it('skips with a NOTE prefix (never SKIP) so the shell stale-gallery guard stays quiet', () => {
    // capture-screenshots.sh greps for '^SKIP ' to detect a stale gallery; a
    // review-sheet skip must use NOTE so a secret-less run does not trip the
    // guard. Scoped to the block: the route loop's legit SKIP for failed
    // cells is outside this slice and cannot satisfy the assertion. The
    // not-to-match is scoped to LOG STATEMENTS (console.*), not the whole
    // block — the section comment legitimately says "not a SKIP, so …" and a
    // future comment reword must not spuriously fail the test.
    expect(reviewSheetBlock).toContain('NOTE: review-sheet cells skipped (set FIREBASE_WEB_API_KEY + FIREBASE_SERVICE_ACCOUNT to render)');
    expect(reviewSheetBlock).toContain('NOTE: review-sheet cells skipped (driver exited ${code})');
    expect(reviewSheetBlock).toContain('NOTE: review-sheet cell ${to} skipped (${err.message})');
    expect(reviewSheetBlock).not.toMatch(/console\.(?:log|warn|error)\(['`]?SKIP /);
  });

  it('gates the spawn behind the reviewSheetReady credential check', () => {
    // The step must only run when BOTH Firebase secrets resolve (the driver's
    // own gate), mirroring the gallery.yml env-trio lock in ci-workflows.test.ts
    // — a future edit that drops the gate would silently run the driver on
    // secret-less fork runs. The spawn call sits inside the else branch of
    // `if (!reviewSheetReady)`, so its position proves the gate guards it.
    const gateIdx = reviewSheetBlock.indexOf('if (!reviewSheetReady)');
    // Anchor on the SPAWN CALL, not the bare filename — the section comment
    // ("reuse the SHARED review-sheet driver (scripts/verify-review-sheet.mjs)")
    // mentions the file before the gate, so a filename search would vacuously
    // pass even if the spawn moved out of the gate's else branch.
    const spawnIdx = reviewSheetBlock.indexOf("spawn('node', ['scripts/verify-review-sheet.mjs'");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(spawnIdx).toBeGreaterThan(gateIdx);
  });

  it('copies BOTH driver outputs into the gallery under stable names', () => {
    // The full copy contract: the temp outputs (01-model-comparison-panels.png,
    // 02-review-sheet-preview.png) must land in the gallery as the stable,
    // README-referenced names (review-sheet-panels.png, review-sheet-preview.png).
    expect(reviewSheetBlock).toContain("{ from: '01-model-comparison-panels.png', to: 'review-sheet-panels.png' }");
    expect(reviewSheetBlock).toContain("{ from: '02-review-sheet-preview.png', to: 'review-sheet-preview.png' }");
    expect(reviewSheetBlock).toContain('await copyFile(`${tmp}/${from}`, `${outArg}/${to}`)');
    // Exactly TWO mappings must survive — a third row silently widens the
    // copied set and would drift the README embed + gallery cell list.
    const files = reviewSheetBlock.match(/const REVIEW_SHEET_FILES = \[([\s\S]*?)\];/)?.[1] ?? '';
    expect([...files.matchAll(/from: '([^']+)'/g)]).toHaveLength(2);
  });

  it('runs the copy step BEFORE the contact sheet is written so captured cells render', () => {
    // Positional contract: the copied cells feed the contact-sheet's Review
    // Sheet section, so the copyFile loop must sit before the screenshots.html
    // write — otherwise the section renders empty even when cells were captured.
    // Compared against the FULL driver: the write lives after the contact-sheet
    // header (outside the block slice), and the ordering is what matters here.
    const copyIdx = DRIVER.indexOf('await copyFile');
    const sheetIdx = DRIVER.indexOf('await writeFile(`${outArg}/screenshots.html`, sheet)');
    expect(copyIdx).toBeGreaterThan(-1);
    expect(sheetIdx).toBeGreaterThan(copyIdx);
  });
});

describe('scripts/capture-gallery.mjs · deployments-feed re-capture step', () => {
  it('has a non-empty deployments-feed block (section headers intact)', () => {
    // A non-empty block guard: if the section headers are ever renamed so the
    // slice resolves to '', every toContain below would fail confusingly.
    expect(feedBlock.length).toBeGreaterThan(0);
    expect(DRIVER).toContain('// ── Deployments feed cell');
    expect(DRIVER).toContain('// ── HTML contact sheet');
  });

  it('spawns the shared capture-deployments-feed.mjs driver (never a duplicated CDP flow)', () => {
    // The live /deployments feed needs a signed-in user, which the demo-mode
    // route capture cannot produce — so the step must reuse the gate driver,
    // not re-drive Chrome itself. The spawn must pass --app (production
    // default, overridable) and --out (the temp dir the PNG is copied from).
    expect(feedBlock).toMatch(/spawn\('node', \['scripts\/capture-deployments-feed\.mjs', '--app', deploymentsFeedAppArg, '--out', tmp\]/);
    // The driver's env must flow through so CI job secrets reach it.
    expect(feedBlock).toContain("cwd: process.cwd(), stdio: 'inherit', env: process.env");
  });

  it('skips with a NOTE prefix (never SKIP) so the shell stale-gallery guard stays quiet', () => {
    // capture-screenshots.sh greps for '^SKIP ' to detect a stale gallery; a
    // deployments-feed skip must use NOTE so a secret-less run does not trip
    // the guard. Scoped to the block: the route loop's legit SKIP for failed
    // cells is outside this slice and cannot satisfy the assertion.
    expect(feedBlock).toContain('NOTE: deployments-feed cell skipped (set FIREBASE_WEB_API_KEY or NEXT_PUBLIC_FIREBASE_API_KEY to render)');
    expect(feedBlock).toContain('NOTE: deployments-feed cell skipped (driver exited ${code})');
    expect(feedBlock).toContain('NOTE: deployments-feed cell ${DEPLOYMENTS_FEED_FILE.to} skipped (${err.message})');
    expect(feedBlock).not.toMatch(/console\.(?:log|warn|error)\(['`]?SKIP /);
  });

  it('gates the spawn behind the deploymentsFeedReady credential check', () => {
    // The step must only run when the Firebase web API key resolves (the
    // driver's own gate), mirroring the review-sheet gate — a future edit that
    // drops the gate would silently run the driver on secret-less fork runs.
    // The spawn call sits inside the else branch of `if (!deploymentsFeedReady)`,
    // so its position proves the gate guards it.
    const gateIdx = feedBlock.indexOf('if (!deploymentsFeedReady)');
    const spawnIdx = feedBlock.indexOf("spawn('node', ['scripts/capture-deployments-feed.mjs'");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(spawnIdx).toBeGreaterThan(gateIdx);
  });

  it('copies the driver PNG into the gallery under the stable name', () => {
    // The full copy contract: the temp output (deployments-feed.png) must land
    // in the gallery under the same stable name referenced by the README and
    // the contact sheet.
    expect(feedBlock).toContain("{ from: 'deployments-feed.png', to: 'deployments-feed.png' }");
    expect(feedBlock).toContain('await copyFile(`${tmp}/${DEPLOYMENTS_FEED_FILE.from}`, `${outArg}/${DEPLOYMENTS_FEED_FILE.to}`)');
    expect(feedBlock).toContain("feedCaptured.push({ route: 'deployments-feed', theme: 'light', name: DEPLOYMENTS_FEED_FILE.to })");
  });

  it('runs the copy step BEFORE the contact sheet is written so the cell renders', () => {
    // Positional contract: the copied cell feeds the contact-sheet's
    // Deployments Feed section, so the copyFile must sit before the
    // screenshots.html write — otherwise the section renders empty even when
    // the cell was captured. Compared against the FULL driver.
    const copyIdx = DRIVER.indexOf('await copyFile(`${tmp}/${DEPLOYMENTS_FEED_FILE.from}');
    const sheetIdx = DRIVER.indexOf('await writeFile(`${outArg}/screenshots.html`, sheet)');
    expect(copyIdx).toBeGreaterThan(-1);
    expect(sheetIdx).toBeGreaterThan(copyIdx);
  });
});

describe('scripts/capture-gallery.mjs · headless Chrome spawn flags', () => {
  // The Chrome spawn args live between `spawn(CHROME, [` and `], { stdio:
  // 'ignore' })`. Scoping to that block keeps every assertion honest: a flag
  // mentioned only in a comment anywhere else in the driver cannot satisfy
  // them (the comment INSIDE the array is stripped by the comment-filter
  // assertion below, so a flag that only appears in prose fails).
  const chromeArgsBlock = DRIVER.slice(
    DRIVER.indexOf('spawn(CHROME, ['),
    DRIVER.indexOf("], { stdio: 'ignore' })"),
  );

  it('has a non-empty Chrome spawn args block (spawn call intact)', () => {
    // A non-empty block guard: if the spawn call is ever rewritten so the
    // slice resolves to '', every assertion below would fail confusingly
    // instead of pointing at the missing block.
    expect(chromeArgsBlock.length).toBeGreaterThan(0);
    expect(DRIVER).toContain('spawn(CHROME, [');
    expect(DRIVER).toContain("], { stdio: 'ignore' })");
  });

  it('passes --no-sandbox and --disable-dev-shm-usage as real array entries (not just comment prose)', () => {
    // The Linux CI runner requires both flags: without --no-sandbox Chrome's
    // sandbox cannot initialize inside the container, and without
    // --disable-dev-shm-usage the shared /dev/shm runs out — either way
    // DevTools never comes up and every cell skips ('Chrome DevTools did not
    // come up'). Stripping `//` comment lines proves the flags are ACTUAL
    // args, not prose: a future edit that moves them into the explanatory
    // comment while dropping them from the array fails the second assertion.
    const argsWithoutComments = chromeArgsBlock
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(argsWithoutComments).toContain("'--no-sandbox'");
    expect(argsWithoutComments).toContain("'--disable-dev-shm-usage'");
    // The comma-anchored form guards against a partial edit that drops one
    // flag's element while leaving a quoted mention behind elsewhere.
    expect(argsWithoutComments).toMatch(/'--no-sandbox',/);
    expect(argsWithoutComments).toMatch(/'--disable-dev-shm-usage',/);
  });

  it('keeps the two flags alongside the remote-debugging-port entry (single Chrome spawn)', () => {
    // The flags must live in THE Chrome spawn this driver uses for capture
    // (port 9444), not some second/vestigial spawn — asserting they appear
    // before the --remote-debugging-port element in the same block proves
    // they are part of the real capture Chrome. It also keeps the spawn count
    // at one, so a duplicated Chrome spawn can't smuggle one flag set.
    const noSandboxIdx = chromeArgsBlock.indexOf("'--no-sandbox'");
    const shmIdx = chromeArgsBlock.indexOf("'--disable-dev-shm-usage'");
    const portIdx = chromeArgsBlock.indexOf('--remote-debugging-port=');
    expect(noSandboxIdx).toBeGreaterThan(-1);
    expect(shmIdx).toBeGreaterThan(-1);
    expect(portIdx).toBeGreaterThan(shmIdx);
    expect(portIdx).toBeGreaterThan(noSandboxIdx);
    // Exactly one Chrome spawn in the whole driver — a second one would need
    // its own flags and this count would catch the split.
    expect(DRIVER.match(/spawn\(CHROME, \[/g)).toHaveLength(1);
  });

  it('passes the text-rendering determinism flags as real array entries (not just comment prose)', () => {
    // The dark cells used to churn by a few pixels of sub-glyph anti-aliasing
    // on small semibold text run to run on the Linux runner while light cells
    // stayed byte-identical. The fix pins Chrome's process-level text state:
    // --disable-lcd-text (grayscale AA, no subpixel jitter),
    // --font-render-hinting=none (deterministic glyph shapes regardless of
    // the runner's FreeType state — full hinting merely moved the residual
    // jitter to other glyphs),
    // --force-color-profile=srgb (no display/color state leaks into
    // rasterization), --disable-gpu-compositing (deterministic software
    // compositor — the source of the last residual jitter, not the hinting
    // mode). Same comment-stripping discipline as the sandbox flags: they
    // must be ACTUAL args, not prose.
    const argsWithoutComments = chromeArgsBlock
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(argsWithoutComments).toContain("'--disable-lcd-text'");
    expect(argsWithoutComments).toContain("'--font-render-hinting=none'");
    expect(argsWithoutComments).toContain("'--force-color-profile=srgb'");
    expect(argsWithoutComments).toContain("'--disable-gpu-compositing'");
    // Comma-anchored forms guard against a partial edit that drops the flag
    // while leaving a quoted mention in a comment elsewhere.
    expect(argsWithoutComments).toMatch(/'--disable-lcd-text',/);
    expect(argsWithoutComments).toMatch(/'--font-render-hinting=none',/);
    expect(argsWithoutComments).toMatch(/'--force-color-profile=srgb',/);
    expect(argsWithoutComments).toMatch(/'--disable-gpu-compositing',/);
  });
});

describe('scripts/capture-gallery.mjs · per-run Chrome profile (--user-data-dir)', () => {
  // Same spawn-args slice the flags describe uses — scoped here because the
  // other describe's const is closed over its own block.
  const chromeArgsBlock = DRIVER.slice(
    DRIVER.indexOf('spawn(CHROME, ['),
    DRIVER.indexOf("], { stdio: 'ignore' })"),
  );

  it('defines USER_DATA_DIR as a unique per-run path (pid + timestamp, never fixed)', () => {
    // A FIXED profile dir (the old '/tmp/gallery-capture-chrome') means two
    // gallery runs on the same machine share one Chrome profile and its
    // SingletonLock — the second run can't start or reuses stale state. The
    // shared per-run pattern (pid + Date.now) makes every launch isolated.
    expect(DRIVER).toMatch(/const USER_DATA_DIR = `\/tmp\/gallery-capture-chrome-\$\{process\.pid\}-\$\{Date\.now\(\)\}`/);
    // The fixed-profile literal must not survive anywhere in the driver.
    expect(DRIVER).not.toContain("'--user-data-dir=/tmp/");
    expect(DRIVER).not.toContain('--user-data-dir=/tmp/gallery-capture-chrome');
  });

  it('passes the per-run profile to the Chrome spawn (template-literal reference)', () => {
    // The constant must actually reach the spawn as the --user-data-dir
    // ARGUMENT — a constant defined but never used would silently keep the
    // driver on whatever path it falls back to.
    expect(chromeArgsBlock).toContain('`--user-data-dir=${USER_DATA_DIR}`');
    expect(chromeArgsBlock).toMatch(/--user-data-dir=\$\{USER_DATA_DIR\}/);
  });

  it('cleans the per-run profile up on exit and on every signal (dropProfile)', () => {
    // A per-run dir that is never removed still leaks /tmp profiles; the
    // cleanup must be wired to normal exit AND to every interrupt signal so
    // no run leaves its profile behind.
    expect(DRIVER).toMatch(/const dropProfile = \(\) => \{ try \{ rmSync\(USER_DATA_DIR, \{ recursive: true, force: true \}\);/);
    expect(DRIVER).toContain("process.on('exit', () => { killChrome(); dropProfile(); })");
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      expect(DRIVER).toContain(`process.on(sig, () => { killChrome(); dropProfile(); process.exit(130); })`);
    }
  });
});

describe('scripts/capture-gallery.mjs · deterministic capture mode (CAPTURE_DETERMINISTIC)', () => {
  it('defines the CAPTURE_DETERMINISTIC flag and fixed pin values', () => {
    // The Integrations cells churn run to run because /api/status returns real
    // ping latencies, an ISO checkedAt, and a draining GitHub rate-limit count.
    // The flag gates the pinning; the fixed constants are the pinned values.
    expect(DRIVER).toContain("process.env.CAPTURE_DETERMINISTIC === '1'");
    expect(DRIVER).toContain('const FIXED_MS = 120;');
    expect(DRIVER).toContain("const FIXED_RATE_LIMIT = '4500/5000';");
  });

  it('pins checkedAt, endpoint.ms, and the GitHub rate-limit counts in /api/status bodies', () => {
    // Each churn field must be rewritten in place: the ISO timestamp, every
    // numeric latency, and the "— N/M req/h left" counts that drain as polls
    // consume the rate limit. A pin that only covers one field leaves the
    // cell churning on the others.
    expect(DRIVER).toContain("if (key === 'checkedAt' && typeof value === 'string') node[key] = FIXED_CHECKED_AT;");
    expect(DRIVER).toContain("else if (key === 'ms' && typeof value === 'number') node[key] = FIXED_MS;");
    expect(DRIVER).toMatch(/req\\\/h left\/\.test\(value\)/);
    expect(DRIVER).toContain('req\\/h left/, `${FIXED_RATE_LIMIT} req/h left`');
  });

  it('enables CDP Fetch interception scoped to /api/status at Response stage', () => {
    // The interception must target exactly the status route the page polls (a
    // broader pattern would pause unrelated requests and risk hanging the
    // run), and pause at Response so the body can be rewritten before render.
    expect(DRIVER).toContain("await send('Fetch.enable',");
    expect(DRIVER).toContain("patterns: [{ urlPattern: '*://*/*api/status*', requestStage: 'Response' }]");
    // The interception must be gated behind the flag — live captures never
    // enable the Fetch domain, so real latencies still flow.
    expect(DRIVER).toContain('if (DETERMINISTIC) {');
  });

  it('fulfills paused responses with the pinned body and never hangs on a hiccup', () => {
    // The paused request must be answered — pinLiveFields the parsed body and
    // fulfill it, with a continueRequest fallback so any interception hiccup
    // (non-JSON body, CDP error) can never stall the page.
    expect(DRIVER).toContain("await send('Fetch.getResponseBody', { requestId });");
    expect(DRIVER).toContain('pinLiveFields(json);');
    expect(DRIVER).toContain("await send('Fetch.fulfillRequest',");
    expect(DRIVER).toContain("await send('Fetch.continueRequest', { requestId });");
  });

  it('capture-screenshots.sh enables the flag so CI + local captures are deterministic', () => {
    // The shell wrapper is the single entry both CI (gallery.yml → npm run
    // capture:screenshots) and local folds use; without the export here the
    // flag would be a dead switch that never fires in the real capture path.
    const shell = readFileSync('scripts/capture-screenshots.sh', 'utf8');
    expect(shell).toContain('export CAPTURE_DETERMINISTIC=1');
  });
});
