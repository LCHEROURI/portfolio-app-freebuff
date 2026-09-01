/**
 * Net trade equity = trade-in value - outstanding payoff.
 *
 * Positive equity means the trade is worth more than the remaining loan.
 * Negative equity (upside-down / underwater) means the remaining loan exceeds
 * the trade value — commonly called being "upside down" on the loan.
 */
export function tradeInEquity(tradeValue: number, payoff: number): number {
  return tradeValue - payoff;
}

/**
 * Returns whether the trade is upside-down (negative equity).
 */
export function isUpsideDown(tradeValue: number, payoff: number): boolean {
  return tradeInEquity(tradeValue, payoff) < 0;
}

/**
 * Categorizes the trade position for display purposes.
 */
export type TradePosition =
  | 'positive'
  | 'even'
  | 'negative';

export function tradePosition(
  tradeValue: number,
  payoff: number,
  tolerance = 1,
): TradePosition {
  const equity = tradeInEquity(tradeValue, payoff);
  if (equity > tolerance) return 'positive';
  if (equity < -tolerance) return 'negative';
  return 'even';
}
