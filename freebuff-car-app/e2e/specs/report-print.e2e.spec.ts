import { test, expect } from '@playwright/test';
import { walkAdvisorToGeneratedReport, EXPECTED_SCORE } from '../helpers/advisor';

// End-to-end: the report screen is the app's only output surface, and its
// four affordances are Print, Copy, and the .md/.txt downloads. Copy and
// downloads get byte/content parity in report-exports.e2e.spec.ts; PRINT is
// the one output that previously had only jsdom class-level coverage. This
// spec drives the real generated report in a browser under @media print and
// asserts:
//
//   1. On screen, the app chrome (layout top bar, step header, bottom nav,
//      deploy-marker footer) is visible; the action buttons are visible.
//   2. Under print emulation, every piece of app chrome is hidden while the
//      report itself (including the populated deal-score section) stays
//      printable — no app navigation leaks onto paper (Prompt 11 contract).
//   3. The Print report button actually calls window.print (captured via a
//      stub, since headless Chromium swallows print dialogs).

test.describe.configure({ timeout: 180_000 });

test('print output hides app chrome and keeps the populated report printable', async ({ page }) => {
  await walkAdvisorToGeneratedReport(page);

  // Capture real print invocations (headless has no print dialog).
  await page.evaluate(() => {
    (window as unknown as { __printCalls: number }).__printCalls = 0;
    window.print = () => {
      (window as unknown as { __printCalls: number }).__printCalls += 1;
    };
  });

  // ---- On-screen (media: screen): chrome and actions are visible ----
  const chrome = page.getByTestId('advisor-chrome');
  const nav = page.getByTestId('advisor-nav');
  const footer = page.getByTestId('advisor-footer');
  await expect(chrome).toBeVisible();
  await expect(nav).toBeVisible();
  await expect(footer).toBeVisible();
  await expect(page.getByRole('link', { name: /back to home/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /print report/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /copy report/i })).toBeVisible();
  await expect(page.getByTestId('download-report')).toBeVisible();
  await expect(page.getByTestId('download-report-txt')).toBeVisible();

  // ---- Print emulation: app chrome must not appear on paper ----
  await page.emulateMedia({ media: 'print' });
  await expect(chrome).toBeHidden();
  await expect(nav).toBeHidden();
  await expect(footer).toBeHidden();
  // Layout top bar + the step header live inside chrome regions.
  await expect(page.getByRole('link', { name: /back to home/i }).first()).toBeHidden();
  await expect(page.getByRole('heading', { name: /Step 11 of 11/i })).toBeHidden();
  // The report's own on-screen action buttons are print:hidden too.
  await expect(page.getByRole('button', { name: /print report/i })).toBeHidden();
  await expect(page.getByRole('button', { name: /copy report/i })).toBeHidden();
  await expect(page.getByTestId('download-report')).toBeHidden();

  // The report itself stays printable, deal-score breakdown included.
  await expect(page.getByRole('heading', { name: /Car Purchase Intelligence Report/i })).toBeVisible();
  await expect(page.locator('body')).toContainText(`${EXPECTED_SCORE} / 100`);
  await expect(page.locator('body')).toContainText('Financing affordability');
  await expect(page.locator('body')).toContainText('Positive trade-in equity / no rollover');

  // ---- Restore screen and confirm the button invokes window.print ----
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: /print report/i }).click();
  const printCalls = await page.evaluate(
    () => (window as unknown as { __printCalls: number }).__printCalls,
  );
  expect(printCalls).toBe(1);
});
