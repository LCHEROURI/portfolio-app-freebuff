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

  it('clicks the REAL Download PDF button on a saved report row', () => {
    expect(SCRIPT).toContain('button[aria-label^="Download PDF of"]');
    expect(SCRIPT).toContain('b.click()');
    expect(SCRIPT).toContain("readdirSync(DOWNLOADS).filter((f) => !f.endsWith('.crdownload'))");
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
