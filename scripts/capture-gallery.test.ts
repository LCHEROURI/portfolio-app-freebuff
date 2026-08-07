import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/capture-gallery.test.ts — lock the review-sheet step inside the
// gallery capture driver.
//
// capture-gallery.mjs re-renders the two Model Comparison review-sheet PNGs
// (review-sheet-panels.png / review-sheet-preview.png) with every gallery run
// by spawning the SHARED verify-review-sheet.mjs driver (the same driver the
// verify:review-sheet gate runs) and copying its two outputs into the gallery
// under stable names. The gallery.yml CI wiring for this is already locked by
// ci-workflows.test.ts; this test locks the DRIVER side, so a future edit that
// silently drops the review-sheet step from capture-gallery.mjs fails here
// instead of shipping a gallery whose print-all pair quietly stops updating.
//
// Scope discipline (mirroring ci-workflows.test.ts): the NOTE-vs-SKIP and
// spawn assertions are scoped to the review-sheet BLOCK (from the
// `// ── Review-sheet cells` section header to the `// ── HTML contact sheet`
// header), NOT the whole file — the route loop legitimately prints
// `SKIP <name>: not the app shell` for failed cells, which must never satisfy
// a "the review-sheet skip uses NOTE" assertion.
// ============================================================================

const DRIVER = readFileSync('scripts/capture-gallery.mjs', 'utf8');

// The review-sheet block: everything between the section header and the HTML
// contact-sheet header. Scoping here keeps every assertion honest — a NOTE /
// spawn / copyFile line can only match inside this step.
const reviewSheetBlock = DRIVER.slice(
  DRIVER.indexOf('// ── Review-sheet cells (Model Comparison print-all)'),
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
