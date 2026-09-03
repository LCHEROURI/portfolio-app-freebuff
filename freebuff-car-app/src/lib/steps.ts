// Single source of truth for the advisor step labels. The advisor page and
// the home-page resume banner both render from this, so they can never drift.
export type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export const TOTAL_STEPS = 11;

export const STEP_LABELS: Record<Step, string> = {
  1: 'Tell me about your deal',
  2: 'Compare your vehicles',
  3: 'Run the financing math',
  4: 'Compare buy vs. lease vs. used',
  5: 'Cost of ownership & ownership budget',
  6: 'Auto shopping strategy & recommendations',
  7: 'Trade-in analysis',
  8: 'Dealer quote audit',
  9: 'D.R.I.V.E. negotiation script',
  10: 'Deal score',
  11: 'Intelligence report',
};
