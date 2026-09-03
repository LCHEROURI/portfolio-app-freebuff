// Advisor step-completion rules, derived from the persisted advisor store.
// A step counts as completed when the user actually saved its data — not
// merely visited it. Steps without a data payload (6: shopping strategy,
// 9: negotiation script) count once the flow has moved past them, and
// step 11 counts once the Intelligence Report has been generated.
import type { AdvisorState } from '@/hooks/useAdvisorState';
import type { Step } from '@/lib/steps';

/** localStorage marker written by IntelligenceReport on generate. */
export const REPORT_STORAGE_KEY = 'freebuff-car-advisor-report-v1';

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function rec(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

export function completedStepSet(state: AdvisorState, reportGenerated = false): Set<Step> {
  const done = new Set<Step>();
  const s = rec(state);
  const step = typeof state.step === 'number' ? state.step : 1;
  // maxStep is monotonic (never moves backward), so "moved past" stays true
  // even after the user navigates back to an earlier step.
  const reached = typeof state.maxStep === 'number' && state.maxStep >= 1 ? state.maxStep : step;

  const intake = rec(s?.intake);
  if (hasText(intake?.monthlyBudget)) done.add(1);

  const vehicles = rec(s?.vehicles);
  const needs = rec(vehicles?.needs);
  const comparing = vehicles?.comparing;
  const anyNeed = needs ? Object.values(needs).some(Boolean) : false;
  const anyComparing = Array.isArray(comparing) && comparing.length > 0;
  if (anyNeed || anyComparing) done.add(2);

  const finance = rec(s?.finance);
  if (hasText(finance?.vehiclePrice)) done.add(3);

  const lease = rec(s?.lease);
  if (lease && Object.keys(lease).length > 0) done.add(4);

  const ownership = rec(s?.ownership);
  if (ownership && Object.keys(ownership).length > 0) done.add(5);

  // Steps 6 and 9 save no form data — completed once the flow moved past them.
  if (reached > 6) done.add(6);
  if (reached > 9) done.add(9);

  const trade = rec(s?.trade);
  if (hasText(trade?.tradeValue) || hasText(trade?.payoff)) done.add(7);

  const fees = rec(s?.fees);
  if (fees && Object.keys(fees).length > 0) done.add(8);

  const dealScore = rec(s?.dealScore);
  if (rec(dealScore?.result)) done.add(10);

  if (reportGenerated) done.add(11);

  return done;
}

export function completedStepCount(state: AdvisorState, reportGenerated = false): number {
  return completedStepSet(state, reportGenerated).size;
}
