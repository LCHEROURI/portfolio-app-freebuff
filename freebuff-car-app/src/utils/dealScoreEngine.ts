/**
 * Deal Score Engine
 *
 * Weighted 0-100 score using the fixed weights from the build manual:
 *
 * - Financing affordability: 25
 * - No unnecessary dealer add-ons: 20
 * - Reasonable documentation fee (<= $150): 20
 * - Matches customer non-negotiable priorities: 20
 * - Positive trade-in equity / no rollover: 15
 * - Total: 100
 *
 * Scoring is deterministic — no AI judgment in the math.
 */
const MAX_SCORE = 100;

export type DealScoreInput = {
  monthlyPayment: number;
  monthlyBudget: number;
  docFee: number;
  addOnCount: number;
  prioritiesMetCount: number;
  priorityCount: number;
  tradeEquity: number;
};

export type DealScoreResult = {
  score: number;
  financingScore: number;
  addOnScore: number;
  docFeeScore: number;
  priorityScore: number;
  equityScore: number;
  breakdown: DealScoreBreakdownItem[];
};

export type DealScoreBreakdownItem = {
  label: string;
  points: number;
  maxPoints: number;
  earned: number;
  reason: string;
};

const DOC_FEE_THRESHOLD = 150;

function financingScore(input: DealScoreInput): { earned: number; reason: string } {
  // Affordability: monthly payment vs budget.
  // Within budget = full 25, partial = scaled, over budget = reduced.
  if (input.monthlyPayment <= 0 || input.monthlyBudget <= 0) {
    return { earned: 0, reason: 'Budget or payment is not set.' };
  }

  if (input.monthlyPayment <= input.monthlyBudget) {
    // Payment is within budget — full score.
    return { earned: 25, reason: 'Monthly payment fits within your budget.' };
  }

  // Payment exceeds budget by some amount — scale down.
  const ratio = input.monthlyBudget / input.monthlyPayment;
  const earned = Math.round(25 * Math.max(0, ratio));
  return {
    earned: Math.max(0, earned),
    reason: `Monthly payment exceeds your budget by ${formatCurrency(input.monthlyPayment - input.monthlyBudget)}.`,
  };
}

function addOnScore(input: DealScoreInput): { earned: number; reason: string } {
  // 20 points if there are no unnecessary add-ons.
  if (input.addOnCount <= 0) {
    return { earned: 20, reason: 'No unnecessary dealer add-ons detected.' };
  }
  // Scale down for each flagged add-on (cap at 0).
  const earned = Math.max(0, 20 - input.addOnCount * 4);
  return {
    earned,
    reason: `${input.addOnCount} high-margin add-on(s) detected.`,
  };
}

function docFeeScore(input: DealScoreInput): { earned: number; reason: string } {
  // 20 points if doc fee <= $150.
  if (input.docFee <= 0) {
    return { earned: 0, reason: 'Documentation fee is not set.' };
  }
  if (input.docFee <= DOC_FEE_THRESHOLD) {
    return { earned: 20, reason: `Documentation fee is within the $150 reference threshold.` };
  }
  // Scale down for excessive doc fee.
  const overage = input.docFee - DOC_FEE_THRESHOLD;
  const earned = Math.max(0, 20 - Math.round(overage / 10));
  return {
    earned,
    reason: `Documentation fee exceeds the $150 reference threshold by ${formatCurrency(overage)}.`,
  };
}

function priorityScore(input: DealScoreInput): { earned: number; reason: string } {
  // 20 points based on how many non-negotiable priorities are met.
  if (input.priorityCount <= 0) {
    return { earned: 0, reason: 'No priorities defined.' };
  }
  const ratio = input.prioritiesMetCount / input.priorityCount;
  const earned = Math.round(20 * ratio);
  return {
    earned,
    reason: `${input.prioritiesMetCount} of ${input.priorityCount} non-negotiable priorities are met.`,
  };
}

function equityScore(input: DealScoreInput): { earned: number; reason: string } {
  // 15 points for positive trade equity (no rollover).
  if (input.tradeEquity > 0) {
    return { earned: 15, reason: 'Trade-in has positive equity — no rollover.' };
  }
  if (input.tradeEquity === 0) {
    return { earned: 10, reason: 'Trade-in value equals payoff — no equity, no rollover.' };
  }
  // Negative equity.
  const penalty = Math.min(15, Math.round(Math.abs(input.tradeEquity) / 200));
  const earned = Math.max(0, 15 - penalty);
  return {
    earned,
    reason: `Trade-in is upside-down by ${formatCurrency(Math.abs(input.tradeEquity))}.`,
  };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function computeDealScore(input: DealScoreInput): DealScoreResult {
  const financing = financingScore(input);
  const addOn = addOnScore(input);
  const docFee = docFeeScore(input);
  const priority = priorityScore(input);
  const equity = equityScore(input);

  const total =
    financing.earned + addOn.earned + docFee.earned + priority.earned + equity.earned;

  return {
    score: Math.max(0, Math.min(MAX_SCORE, total)),
    financingScore: financing.earned,
    addOnScore: addOn.earned,
    docFeeScore: docFee.earned,
    priorityScore: priority.earned,
    equityScore: equity.earned,
    breakdown: [
      {
        label: 'Financing affordability',
        points: 25,
        maxPoints: 25,
        earned: financing.earned,
        reason: financing.reason,
      },
      {
        label: 'No unnecessary dealer add-ons',
        points: 20,
        maxPoints: 20,
        earned: addOn.earned,
        reason: addOn.reason,
      },
      {
        label: 'Reasonable documentation fee',
        points: 20,
        maxPoints: 20,
        earned: docFee.earned,
        reason: docFee.reason,
      },
      {
        label: 'Matches customer non-negotiable priorities',
        points: 20,
        maxPoints: 20,
        earned: priority.earned,
        reason: priority.reason,
      },
      {
        label: 'Positive trade-in equity / no rollover',
        points: 15,
        maxPoints: 15,
        earned: equity.earned,
        reason: equity.reason,
      },
    ],
  };
}
