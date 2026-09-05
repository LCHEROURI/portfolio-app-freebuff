import { expect, type Page } from '@playwright/test';

// Shared driver for the advisor E2E specs. Walks a genuinely EMPTY session
// Step 1 -> Step 11 (nothing seeded), ending with the Intelligence Report
// generated through the real consent gate. Steps 2 uses the built-in demo
// inventory (no MarketCheck key in CI), so the sample fleet is deterministic.

export const DEMO_VALUES = {
  budget: '600',
  downPayment: '5000',
  price: '28595',
  apr: '6.5',
  tradeValue: '12000',
  payoff: '9000',
  monthlyPayment: '462',
  docFee: '129',
  addOns: '3',
  prioritiesTotal: '2',
  prioritiesMet: '2',
  tradeEquity: '3000',
};

export async function fillNumber(page: Page, label: RegExp, value: string) {
  await page.getByRole('spinbutton', { name: label }).fill(value);
}

/** Exactly one step header ("Step N of 11 — …") and no embedded "of 10" remnants. */
export async function expectSingleStepHeader(page: Page, step: number) {
  const h1 = page.locator('h1');
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText(new RegExp(`^Step ${step} of 11`));
  await expect(page.getByText(/Step \d of 10/)).toHaveCount(0);
}

/** With the walk's inputs the engine scores 88 (25+8+20+20+15). */
export const EXPECTED_SCORE = '88';

export async function walkAdvisorToGeneratedReport(page: Page) {
  await page.goto('/advisor');

  // ---- Step 1 — intake ----
  await page.getByRole('heading', { name: /Step 1 of 11/i }).waitFor();
  await expectSingleStepHeader(page, 1);
  await fillNumber(page, /monthly budget/i, DEMO_VALUES.budget);
  await fillNumber(page, /desired down payment/i, DEMO_VALUES.downPayment);
  await page.getByRole('radio', { name: 'Good' }).check({ force: true });
  await page.getByRole('button', { name: /save & continue/i }).click();

  // ---- Step 2 — compare vehicles (demo fleet) ----
  await page.getByRole('heading', { name: /Step 2 of 11/i }).waitFor();
  await expectSingleStepHeader(page, 2);
  await page.getByRole('checkbox', { name: /all-wheel drive/i }).check({ force: true });
  await page.getByRole('checkbox', { name: /5\+ seats/i }).check({ force: true });
  const compare = page.getByRole('checkbox', { name: /include in comparison/i });
  await compare.nth(0).check({ force: true }); // Camry
  await compare.nth(1).check({ force: true }); // Outback
  await page.getByRole('button', { name: /continue to financing/i }).click();

  // ---- Step 3 — financing math (price prefilled from the Camry) ----
  await page.getByRole('heading', { name: /Step 3 of 11/i }).waitFor();
  await expectSingleStepHeader(page, 3);
  await expect(page.getByRole('spinbutton', { name: /vehicle price/i })).toHaveValue(DEMO_VALUES.price);
  await fillNumber(page, /down payment/i, DEMO_VALUES.downPayment);
  await fillNumber(page, /apr/i, DEMO_VALUES.apr);
  await page.getByRole('button', { name: /^calculate$/i }).click();

  // ---- Step 4 — buy vs. lease vs. used (defaults) ----
  await page.getByRole('heading', { name: /Step 4 of 11/i }).waitFor();
  await expectSingleStepHeader(page, 4);
  await page.getByRole('button', { name: /save comparison/i }).click();

  // ---- Step 5 — ownership budget (defaults) ----
  await page.getByRole('heading', { name: /Step 5 of 11/i }).waitFor();
  await expectSingleStepHeader(page, 5);
  await page.getByRole('button', { name: /^calculate$/i }).click();

  // ---- Step 6 — shopping strategy ----
  await page.getByRole('heading', { name: /Step 6 of 11/i }).waitFor();
  await expectSingleStepHeader(page, 6);
  const step6Continue = page.getByRole('button', { name: /continue to/i });
  await expect(step6Continue).toHaveText(/Continue to trade-in analysis/i);
  await expect(step6Continue).not.toHaveText(/budget breakdown/i);
  await step6Continue.click();

  // ---- Step 7 — trade-in ----
  await page.getByRole('heading', { name: /Step 7 of 11/i }).waitFor();
  await expectSingleStepHeader(page, 7);
  await fillNumber(page, /trade-in value/i, DEMO_VALUES.tradeValue);
  await fillNumber(page, /outstanding payoff/i, DEMO_VALUES.payoff);
  await page.getByRole('button', { name: /analyze trade/i }).click();

  // ---- Step 8 — fee audit (defaults) ----
  await page.getByRole('heading', { name: /Step 8 of 11/i }).waitFor();
  await expectSingleStepHeader(page, 8);
  await page.getByRole('button', { name: /audit quote/i }).click();

  // ---- Step 9 — negotiation script ----
  await page.getByRole('heading', { name: /Step 9 of 11/i }).waitFor();
  await expectSingleStepHeader(page, 9);
  const step9Continue = page.getByRole('button', { name: /continue to/i });
  await expect(step9Continue).toHaveText(/Continue to deal score/i);
  await step9Continue.click();

  // ---- Step 10 — deal score ----
  await page.getByRole('heading', { name: /Step 10 of 11/i }).waitFor();
  await expectSingleStepHeader(page, 10);
  await fillNumber(page, /monthly payment/i, DEMO_VALUES.monthlyPayment);
  await fillNumber(page, /monthly budget/i, DEMO_VALUES.budget);
  await fillNumber(page, /documentation fee/i, DEMO_VALUES.docFee);
  await fillNumber(page, /flagged add-ons/i, DEMO_VALUES.addOns);
  await fillNumber(page, /total priorities/i, DEMO_VALUES.prioritiesTotal);
  await fillNumber(page, /priorities met/i, DEMO_VALUES.prioritiesMet);
  await fillNumber(page, /trade-in equity/i, DEMO_VALUES.tradeEquity);
  await page.getByRole('button', { name: /score this deal/i }).click();

  // ---- Step 11 — generate the Intelligence Report ----
  await page.getByRole('heading', { name: /Step 11 of 11/i }).waitFor();
  await expectSingleStepHeader(page, 11);
  await page.getByRole('checkbox', { name: /not financial advice/i }).check({ force: true });
  await page.getByRole('button', { name: /generate report/i }).click();
  await expect(page.getByRole('heading', { name: /Car Purchase Intelligence Report/i })).toBeVisible();
}
