/**
 * Consolidated calculator helpers.
 *
 * This file re-exports and adds higher-level helpers that combine the
 * lower-level utilities as the app grows. Keep financial math isolated here
 * or in the dedicated utility files — not in UI components.
 */

export { monthlyPayment, totalInterest, totalCost } from './financeCalculators';
export {
  tradeInEquity,
  isUpsideDown,
  tradePosition,
  type TradePosition,
} from './tradeInEquity';
export {
  docFeeFlags,
  addOnFlags,
  quoteRedFlags,
  HIGHLAND_ADD_ONS,
  type RedFlag,
} from './redFlags';
export {
  computeDealScore,
  type DealScoreInput,
  type DealScoreResult,
  type DealScoreBreakdownItem,
} from './dealScoreEngine';
