import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/verify-reports-pdf-flow.test.ts — lock the Reports-page Download
// PDF UI gate contract.
//
// The gate is a headless-Chrome CDP driver (owner session injected, real
// button click, download captured via Browser.setDownloadBehavior), so its
// pure surface is small; the live HTTP/download surface is contract-locked by
// reading the real module from disk (the same approach the other gate tests
// use), so a future edit that weakens the %PDF- assertion, drops the real
// button click, or loses the CDP download capture fails here.
// ============================================================================

const SCRIPT = readFileSync('scripts/verify-reports-pdf-flow.mjs', 'utf8');

describe('scripts/verify-reports-pdf-flow.mjs · source contract', () => {
  it('mints the owner session via the shared SA-signed custom-token helper', () => {
    expect(SCRIPT).toContain("import { mintCustomToken } from './verify-deployed-pdf.mjs'");
    expect(SCRIPT).toContain('mintCustomToken(saJson, OWNER)');
    expect(SCRIPT).toContain('accounts:signInWithCustomToken');
  });

  it('injects the session into IndexedDB (firebaseLocalStorageDb, [DEFAULT] key)', () => {
    // The modern SDK persists auth in IndexedDB keyed by appName "[DEFAULT]",
    // not appId — a localStorage-only injection silently fails. The gate must
    // keep the proven record shape (uid + stsTokenManager + booleans).
    expect(SCRIPT).toContain("indexedDB.open('firebaseLocalStorageDb', 1)");
    expect(SCRIPT).toContain("createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' })");
    expect(SCRIPT).toContain('`firebase:authUser:${API_KEY}:[DEFAULT]`');
  });

  it('enables the CDP download capture so the browser-level file is observed', () => {
    expect(SCRIPT).toContain("Browser.setDownloadBehavior");
    expect(SCRIPT).toContain('behavior: \'allow\', downloadPath: DOWNLOADS, eventsEnabled: true');
  });

  it('counts /api/print/pdf POSTs at the CDP Network layer for the race proof', () => {
    expect(SCRIPT).toContain("await main.send('Network.enable')");
    expect(SCRIPT).toContain("m.method === 'Network.requestWillBeSent'");
    expect(SCRIPT).toContain("url.includes('/api/print/pdf')");
  });

  it('uses a fresh downloads dir per run so stale same-named files can never mask a real download', () => {
    // Chrome overwrites same-named downloads IN PLACE in the CDP dir; with a
    // shared default OUT, a filename from a previous run was already in the
    // pre-click baseline, the fresh-file filter never saw the new file, and
    // every surface failed with "no real PDF appeared" while the PDF actually
    // landed. The default OUT must be unique per run like the Chrome profile.
    expect(SCRIPT).toContain('flag(\'--out\', `/tmp/reports-pdf-flow-${process.pid}-${Date.now()}`)');
    expect(SCRIPT).toContain('mkdirSync(DOWNLOADS, { recursive: true })');
  });

  it('warms the serverless PDF renderer with a DIRECT fetch before the first click', () => {
    // The first UI click repeatedly missed the download window on a cold
    // serverless instance while the second and third clicks landed fine. The
    // warm-up must be a Node-side fetch (NOT through the page) so the CDP
    // Network POST count the race proof asserts stays untouched, and it must
    // carry the owner idToken so it exercises the real authenticated path.
    expect(SCRIPT).toContain("JSON.stringify({ title: 'PDF renderer warm-up' })");
    expect(SCRIPT).toContain("authorization: `Bearer ${exchange.idToken}`");
    expect(SCRIPT).toContain("fetch(`${APP}/api/print/pdf`");
  });

  it('drives a rapid second click once the busy lock engages (double-click race proof)', () => {
    // The live lock proof: after the first click the page disables the button
    // (pdfBusy); the gate waits for the committed disabled state, attempts a
    // second click, and asserts exactly one POST + exactly one file across the
    // double-click — mirroring the unit-level disabled-while-busy tests.
    expect(SCRIPT).toContain('Double-click race lock proof');
    expect(SCRIPT).toContain('busy lock engaged (button disabled mid-flight)');
    expect(SCRIPT).toContain('rapid second click attempted on the disabled button');
    expect(SCRIPT).toContain('exactly 1 /api/print/pdf POST across the double-click');
    expect(SCRIPT).toContain('exactly 1 PDF file to land across the double-click');
    // The race runs on EVERY surface, so a future surface edit can't silently
    // drop the proof from one page.
    expect(SCRIPT.match(/race: true/g)?.length).toBe(3);
  });

  it('clicks the REAL Download PDF button on a saved report row', () => {
    expect(SCRIPT).toContain('button[aria-label^="Download PDF of"]');
    expect(SCRIPT).toContain('b.click()');
  });

  it('accepts ONLY real .pdf files as the download (ignores crash-dump artifacts)', () => {
    // Under load the renderer can crash mid-click and Chrome drops a minidump
    // named after the page (e.g. downloads.html, Cr24 magic) into the download
    // dir. The gate must filter on the .pdf extension — grabbing the first new
    // file would fail the %PDF- check with a confusing bad-header error.
    expect(SCRIPT).toContain("f.endsWith('.pdf') && !f.endsWith('.crdownload')");
    expect(SCRIPT).toContain('no real PDF download appeared within 120s');
  });

  it('asserts the downloaded file is a real PDF, not a stub', () => {
    expect(SCRIPT).toContain("buf.subarray(0, 5).toString() === '%PDF-'");
    expect(SCRIPT).toContain('buf.length <= 1000');
  });

  it('asserts no error toast surfaces after each click (button is not silently dead)', () => {
    expect(SCRIPT).toContain('/PDF export failed|Failed to.*PDF|Chrome unavailable/');
    expect(SCRIPT).toContain('/Something went wrong|There was an error/');
    // Each surface checks its own post-click error state (three checks, one
    // per surface) so a dead button on any page fails the gate.
    expect(SCRIPT).toContain('error surfaced after the Reports click');
    expect(SCRIPT).toContain('error surfaced after the Command Center click');
    expect(SCRIPT).toContain('error surfaced after the Model Comparison click');
  });

  it('drives all THREE printable surfaces (Reports, Top Three, review sheet)', () => {
    expect(SCRIPT).toContain('button[aria-label^="Download PDF of"]');
    expect(SCRIPT).toContain("Download today's top three as PDF");
    expect(SCRIPT).toContain('Download all winner recommendations as PDF');
    expect(SCRIPT).toContain('/model-comparison');
  });

  it('generates a winner recommendation via AI Recommend when none is saved', () => {
    expect(SCRIPT).toContain("(b.textContent ?? '').includes('AI Recommend')");
    expect(SCRIPT).toContain('document.body.innerText.match(/ai winner recommendation/gi)');
  });

  it('emits the ten prefixed sub-result markers for the verify:all summary', () => {
    expect(SCRIPT).toContain('VERIFY-SUBRESULT|reports-pdf-session|');
    expect(SCRIPT).toContain('VERIFY-SUBRESULT|reports-pdf-page|');
    expect(SCRIPT).toContain('VERIFY-SUBRESULT|reports-pdf-click|');
    expect(SCRIPT).toContain('VERIFY-SUBRESULT|reports-pdf-download|');
    expect(SCRIPT).toContain('VERIFY-SUBRESULT|cc-pdf-page|');
    expect(SCRIPT).toContain('VERIFY-SUBRESULT|cc-pdf-click|');
    expect(SCRIPT).toContain('VERIFY-SUBRESULT|cc-pdf-download|');
    expect(SCRIPT).toContain('VERIFY-SUBRESULT|mc-pdf-page|');
    expect(SCRIPT).toContain('VERIFY-SUBRESULT|mc-pdf-click|');
    expect(SCRIPT).toContain('VERIFY-SUBRESULT|mc-pdf-download|');
  });

  it('cleans up the headless Chrome profile and kill the browser on every exit path', () => {
    expect(SCRIPT).toContain("process.on('exit', killChrome)");
    expect(SCRIPT).toContain('rmSync(USER_DATA_DIR, { recursive: true, force: true })');
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      expect(SCRIPT).toContain(`'${sig}'`);
    }
  });

  it('fails loudly when any of the owner-session trio is missing', () => {
    expect(SCRIPT).toContain("missing.push('FIREBASE_WEB_API_KEY')");
    expect(SCRIPT).toContain("missing.push('FIREBASE_SERVICE_ACCOUNT')");
    expect(SCRIPT).toContain("missing.push('REPORT_OWNER_ID')");
  });
});
