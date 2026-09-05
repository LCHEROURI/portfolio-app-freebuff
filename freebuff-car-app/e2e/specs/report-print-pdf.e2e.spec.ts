import { test, expect } from '@playwright/test';
import { walkAdvisorToGeneratedReport, EXPECTED_SCORE } from '../helpers/advisor';

// End-to-end: report-print.e2e.spec.ts proves the @media print CSS hides the
// app chrome in a browser. This spec goes one layer deeper: it renders an
// ACTUAL print PDF through Chromium's real print pipeline (page.pdf, which
// respects @media print exactly like File > Print) and extracts the paper's
// text with pdfjs to assert what physically lands on the page:
//
//   1. The paper output is a real, non-trivial PDF.
//   2. The app chrome is absent from the PAPER text: layout top bar, step
//      header ("Step 11 of 11"), bottom nav, deploy-marker footer, and the
//      report's own action buttons (Print/Copy/Download/Start Over).
//   3. The report content itself IS on the paper: title, every section
//      heading, the populated deal-score figure, and the negotiation rules.

test.describe.configure({ timeout: 180_000 });

// pdfjs-dist's Node entry is ESM-only; Playwright compiles specs to CJS, so
// load it through a dynamic import (the PDF text extractor is test-only — it
// never ships in the app bundle).
async function pdfText(pdfBytes: Uint8Array): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: pdfBytes });
  const doc = await loadingTask.promise;
  try {
    let text = '';
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      text += content.items.map((item: { str?: string }) => item.str ?? '').join(' ') + '\n';
    }
    return text;
  } finally {
    await loadingTask.destroy();
  }
}

// Chromium's PDF writer can split one visible word across several text runs
// (on CI's Linux font fallback "financed" extracts as "fi nanced") — a pure
// extraction artifact: the paper renders the correct word. Matching on the
// whitespace-stripped text keeps the assertions faithful to what is ON the
// paper while tolerating those run splits (and stays strict for chrome
// absence, since any leaked chrome text would still appear after stripping).
const norm = (s: string) => s.replace(/\s+/g, '');

function assertOnPaper(paperText: string, required: string[]) {
  const missing = required.filter((token) => !norm(paperText).includes(norm(token)));
  expect(missing, `tokens missing from the paper output — ${missing.join(', ')}`).toEqual([]);
}

function assertNotOnPaper(paperText: string, forbidden: string[]) {
  const leaked = forbidden.filter((token) => norm(paperText).includes(norm(token)));
  expect(leaked, `app chrome leaked onto the paper — ${leaked.join(', ')}`).toEqual([]);
}

test('real Chromium print PDF carries the report and excludes every piece of app chrome', async ({ page }) => {
  await walkAdvisorToGeneratedReport(page);

  // Let any webfont finish so the paper output is complete before printing.
  await page.evaluate(() => document.fonts?.ready);

  // page.pdf() drives Chromium's real print-to-file pipeline (headless
  // Chromium only) and applies @media print exactly as a user's File > Print
  // would — the strongest possible assertion that print CSS holds on paper.
  const pdf = await page.pdf({ format: 'Letter', printBackground: true });
  expect(pdf.length).toBeGreaterThan(10_000);

  const paperText = await pdfText(new Uint8Array(pdf));

  // ---- App chrome must NOT be on the paper ----
  assertNotOnPaper(paperText, [
    // Layout top bar + the step header live in print:hidden chrome regions.
    'Back to home',
    'Deal Analysis',
    'Step 11 of 11',
    // Bottom nav (back control) and the deploy-marker footer.
    'Back to deal score',
    'deploy marker',
    // The report's own on-screen action affordances are print:hidden too.
    'Print report',
    'Copy report',
    'Download .md',
    'Download .txt',
    'Start Over',
  ]);

  // ---- The report itself must BE on the paper ----
  assertOnPaper(paperText, [
    'Car Purchase Intelligence Report',
    // Every section heading…
    'Your budget',
    'Financing math',
    'Trade-in position',
    'Dealer-quote audit',
    'Monthly ownership budget',
    'Non-negotiable needs',
    'Side-by-side comparison',
    'Deal score',
    'Negotiation ground rules',
    // …the populated deal score from the saved Step 10 result…
    `${EXPECTED_SCORE} / 100`,
    'Financing affordability',
    'Positive trade-in equity',
    // …and a full report line, proving content made it onto paper.
    'Negotiate the out-the-door price first',
  ]);
});
