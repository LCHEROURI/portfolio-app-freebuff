// Pure budget→max-price conversion for the live inventory search.
//
// Step 1 collects a monthly budget, down payment, and credit range. The
// inventory API (MarketCheck) filters by total price, so the client's budget
// must be converted into an approximate maximum vehicle price the user can
// afford. This module holds that math — pure and unit-testable, no I/O.
//
// Method (conservative by construction):
//   1. Amortize the monthly budget over a standard 60-month term at the APR
//      for the user's credit tier (industry-typical averages for a new-car
//      purchase). This yields the maximum loan principal.
//   2. Add the down payment: with more cash down, the same monthly budget
//      finances a more expensive car.
//   3. Strip the headroom reserved for sales tax and registration/title/doc
//      fees, because the filter must apply to the LISTED MSRP, not the
//      out-the-door number (see FEE_HEADROOM_FACTOR).
//   4. Round DOWN to the nearest $100. A result that never overstates the
//      budget is safer than one that sometimes does.
//
// Assumptions are explicit on purpose: the advisor's Step 3 lets the user
// enter their real term/APR, so these defaults only shape the Step 2 search
// — they never feed the financing math.

/** Loan term used to convert a monthly budget into a price ceiling. */
export const BUDGET_TERM_MONTHS = 60;

/** Sales tax + registration/title/doc-fee reserve, as a share of price. */
export const FEE_HEADROOM_FACTOR = 0.094;

/** Typical new-car purchase APR by credit tier (annual %). */
export const APR_BY_CREDIT: Record<'poor' | 'fair' | 'good' | 'excellent', number> = {
  poor: 11.0,
  fair: 8.5,
  good: 6.5,
  excellent: 5.0,
};

/** Monthly payment for principal P at rate r over n months (amortized). */
export function monthlyPayment(principal: number, annualRatePercent: number, termMonths: number): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  if (annualRatePercent <= 0) return principal / termMonths;
  const monthlyRate = (annualRatePercent / 100) / 12;
  const factor = Math.pow(1 + monthlyRate, termMonths);
  return (principal * (monthlyRate * factor)) / (factor - 1);
}

/** Principal whose amortized payment equals `payment` at rate r over n months. */
export function maxPrincipalForPayment(payment: number, annualRatePercent: number, termMonths: number): number {
  if (payment <= 0 || termMonths <= 0) return 0;
  if (annualRatePercent <= 0) return payment * termMonths;
  const monthlyRate = (annualRatePercent / 100) / 12;
  const factor = Math.pow(1 + monthlyRate, termMonths);
  return (payment * (factor - 1)) / (monthlyRate * factor);
}

export interface PaymentEstimateInput {
  /** Listed vehicle price (MSRP) in dollars. */
  price: number;
  /** Down payment in dollars (e.g. 5000). */
  downPayment: number;
  /** Credit tier from Step 1; '' when the user has not chosen yet. */
  creditRange: string;
  /** Loan term in months. Defaults to BUDGET_TERM_MONTHS. */
  termMonths?: number;
  /** Override APR (annual %) — used by tests to pin exact values. */
  aprOverride?: number;
}

/**
 * Estimated monthly payment for a listed price under the SAME assumptions as
 * maxPriceForBudget (tier APR, BUDGET_TERM_MONTHS, FEE_HEADROOM_FACTOR), so a
 * vehicle priced at the user's ceiling shows a payment ~= their budget.
 * Returns null when no meaningful estimate exists (non-positive price, or a
 * price that does not exceed the down payment — nothing left to finance).
 */
export function estimateMonthlyPayment(input: PaymentEstimateInput): number | null {
  const { price, downPayment, creditRange, termMonths = BUDGET_TERM_MONTHS } = input;
  if (!Number.isFinite(price) || price <= 0) return null;
  const down = downPayment > 0 ? downPayment : 0;
  if (down >= price) return null;

  const apr = input.aprOverride ?? APR_BY_CREDIT[creditRange as keyof typeof APR_BY_CREDIT] ?? APR_BY_CREDIT.good;
  const taxed = price * (1 + FEE_HEADROOM_FACTOR);
  const principal = taxed - down;
  return Math.round(monthlyPayment(principal, apr, termMonths));
}

export interface BudgetInput {
  /** Monthly payment budget in dollars (e.g. 4500). */
  monthlyBudget: number;
  /** Down payment in dollars (e.g. 5000). */
  downPayment: number;
  /** Credit tier from Step 1; '' when the user has not chosen yet. */
  creditRange: string;
  /** Loan term in months. Defaults to BUDGET_TERM_MONTHS. */
  termMonths?: number;
  /** Override APR (annual %) — used by tests to pin exact values. */
  aprOverride?: number;
}

/**
 * Maximum vehicle price the budget supports, or null when the inputs don't
 * produce a usable ceiling (non-positive budget, or a ceiling that rounds
 * below $100). Null means "cannot filter by price", NOT a $0 budget.
 */
export function maxPriceForBudget(input: BudgetInput): number | null {
  const { monthlyBudget, downPayment, creditRange, termMonths = BUDGET_TERM_MONTHS } = input;
  if (!Number.isFinite(monthlyBudget) || monthlyBudget <= 0) return null;

  const apr = input.aprOverride ?? APR_BY_CREDIT[creditRange as keyof typeof APR_BY_CREDIT] ?? APR_BY_CREDIT.good;
  const principal = maxPrincipalForPayment(monthlyBudget, apr, termMonths);
  const raw = (principal + (downPayment > 0 ? downPayment : 0)) / (1 + FEE_HEADROOM_FACTOR);
  if (!Number.isFinite(raw) || raw <= 0) return null;

  const floored = Math.floor(raw / 100) * 100;
  return floored > 0 ? floored : null;
}
