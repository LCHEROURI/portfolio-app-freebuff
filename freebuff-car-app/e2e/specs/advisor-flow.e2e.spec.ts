import { test, expect } from '@playwright/test';
import {
  walkAdvisorToGeneratedReport,
  EXPECTED_SCORE,
} from '../helpers/advisor';

// End-to-end: full advisor walk Step 1 -> Step 11 against the PRODUCTION
// build (playwright.config webServer runs `next build && next start`), with a
// genuinely empty session — nothing is seeded. The shared walk helper drives
// every screen and guards per-step invariants (exactly one "Step N of 11"
// header, no embedded "of 10" remnants, and honest continue-button labels on
// Steps 6 and 9). This spec adds the report-level assertion: the generated
// Intelligence Report's Deal score section is populated from the SAVED Step
// 10 result (a past bug saved the stale/null result, so the report claimed
// Step 10 was "not completed").

test.describe.configure({ timeout: 180_000 });

const SCORE_ROWS = [
  'Financing affordability',
  'No unnecessary dealer add-ons',
  'Reasonable documentation fee',
  'Matches customer non-negotiable priorities',
  'Positive trade-in equity / no rollover',
];

test('advisor 1→11: single header per step, honest button labels, populated deal score', async ({ page }) => {
  await walkAdvisorToGeneratedReport(page);

  // The deal-score section must come from the SAVED Step 10 result: a real
  // score out of 100, its five weighted rows, and no "not completed" text.
  await expect(page.getByRole('heading', { name: /Deal score/i }).first()).toBeVisible();
  const body = page.locator('body');
  await expect(body).toContainText(`${EXPECTED_SCORE} / 100`);
  await expect(body).not.toContainText(/Step 10 not completed/);
  for (const row of SCORE_ROWS) {
    await expect(body).toContainText(row);
  }
});
