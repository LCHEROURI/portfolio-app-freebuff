'use client';

import IntakeForm from '@/components/advisor/IntakeForm';
import VehicleNeeds from '@/components/advisor/VehicleNeeds';
import FinanceCalc from '@/components/advisor/FinanceCalc';
import LeaseMatrix from '@/components/advisor/LeaseMatrix';
import OwnershipBudget from '@/components/advisor/OwnershipBudget';
import TradeEvaluator from '@/components/advisor/TradeEvaluator';
import DriveScript from '@/components/advisor/DriveScript';
import IntelligenceReport from '@/components/advisor/IntelligenceReport';
import FeeAuditor from '@/components/advisor/FeeAuditor';
import DealScoreCard from '@/components/advisor/DealScoreCard';
import ShoppingStrategy from '@/components/advisor/ShoppingStrategy';
import { useState } from 'react';

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

const STEP_LABELS: Record<Step, string> = {
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

const STEP_DESCRIPTIONS: Record<Step, string> = {
  1: 'Start with your budget and priorities. Everything else builds from this.',
  2: 'Review the vehicles below and check the needs that matter to you.',
  3: 'Enter the vehicle price, down payment, APR, and term to see your monthly payment and total cost.',
  4: 'Compare buying new, leasing, and buying used side by side. Adjust any number to see how the trade-offs shift.',
  5: 'Build a realistic monthly ownership budget. Enter your estimated costs for each category.',
  6: 'Based on your needs, vehicles are grouped into three tiers with strengths, concerns, and next steps.',
  7: 'Enter the trade-in value and payoff to see your net equity position.',
  8: 'Itemize the dealer quote and audit fees and add-ons for red flags.',
  9: 'Scripts for the most common dealer tactics — read before you visit.',
  10: 'Your weighted 0-100 deal score with the full breakdown.',
  11: 'Printable summary of everything you entered and learned.',
};

export default function AdvisorPage() {
  const [step, setStep] = useState<Step>(1);

  const stepLabel = STEP_LABELS[step];

  const stepDescription = STEP_DESCRIPTIONS[step];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">
          Step {step} of 10 — {stepLabel}
        </h1>
        <p className="mt-1 text-ink-600">{stepDescription}</p>
      </div>

      {step === 1 ? (
        <IntakeForm onComplete={() => setStep(2)} />
      ) : step === 2 ? (
        <VehicleNeeds onContinue={() => setStep(3)} />
      ) : step === 3 ? (
        <FinanceCalc onComplete={() => setStep(4)} />
      ) : step === 4 ? (
        <LeaseMatrix onComplete={() => setStep(5)} />
      ) : step === 5 ? (
        <OwnershipBudget onComplete={() => setStep(6)} />
      ) : step === 6 ? (
        <ShoppingStrategy onContinue={() => setStep(7)} />
      ) : step === 7 ? (
        <TradeEvaluator onComplete={() => setStep(8)} />
      ) : step === 8 ? (
        <FeeAuditor onComplete={() => setStep(9)} />
      ) : step === 9 ? (
        <DriveScript onComplete={() => setStep(10)} />
      ) : step === 10 ? (
        <DealScoreCard onComplete={() => setStep(11)} />
      ) : (
        <IntelligenceReport />
      )}

      <div className="flex items-center justify-between pt-4">
        {step > 1 && (
          <button
            type="button"
            onClick={() => setStep((s) => (s - 1) as Step)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink-100 px-4 py-2 text-sm font-medium text-ink-700 shadow-sm transition-colors hover:bg-ink-200"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to {step === 2 ? 'intake' : step === 3 ? 'vehicles' : step === 4 ? 'financing' : step === 5 ? 'comparison' : step === 6 ? 'ownership budget' : step === 7 ? 'shopping strategy' : 'trade-in'}
          </button>
        )}
        <a
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to home
        </a>
      </div>
    </div>
  );
}
