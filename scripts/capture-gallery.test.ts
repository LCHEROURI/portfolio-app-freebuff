import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/capture-gallery.test.ts — lock the review-sheet AND deployments-feed
// steps inside the gallery capture driver.
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
