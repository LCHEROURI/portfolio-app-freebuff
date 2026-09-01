/**
 * Amortization-based monthly payment.
 *
 * Payment = P * [ r(1+r)^n / ((1+r)^n - 1) ]
 *
 * Handles 0% APR without division-by-zero: when the rate is zero the
 * payment is simply principal divided across the term.
 */
export function monthlyPayment(
  principal: number,
  annualRatePercent: number,
  termMonths: number,
): number {
  if (principal <= 0 || termMonths <= 0) return 0;

  if (annualRatePercent <= 0) {
    // 0% APR — simple division, no compounding.
    return principal / termMonths;
  }

  const monthlyRate = (annualRatePercent / 100) / 12;
  const factor = Math.pow(1 + monthlyRate, termMonths);
  const payment =
    principal * (monthlyRate * factor) / (factor - 1);

  return payment;
}

/**
 * Total interest paid over the life of the loan.
 */
export function totalInterest(
  principal: number,
  annualRatePercent: number,
  termMonths: number,
): number {
  const payment = monthlyPayment(principal, annualRatePercent, termMonths);
  return payment * termMonths - principal;
}

/**
 * Total cost of financing (principal + interest).
 */
export function totalCost(
  principal: number,
  annualRatePercent: number,
  termMonths: number,
): number {
  const payment = monthlyPayment(principal, annualRatePercent, termMonths);
  return payment * termMonths;
}
