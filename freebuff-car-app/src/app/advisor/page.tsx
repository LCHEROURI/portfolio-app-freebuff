'use client';

import IntakeForm from '@/components/advisor/IntakeForm';
import VehicleNeeds from '@/components/advisor/VehicleNeeds';
import FinanceCalc from '@/components/advisor/FinanceCalc';
import LeaseMatrix from '@/components/advisor/LeaseMatrix';
import OwnershipBudget from '@/components/advisor/OwnershipBudget';
import TradeEvaluator from '@/components/advisor/TradeEvaluator';
import ShoppingStrategy from '@/components/advisor/ShoppingStrategy';
import { useState } from 'react';

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export default function AdvisorPage() {
  const [step, setStep] = useState<Step>(1);

  const stepLabel = step === 1
    ? 'Tell me about your deal'
    : step === 2
      ? 'Compare your vehicles'
      : step === 3
        ? 'Run the financing math'
        : step === 4
          ? 'Compare buy vs. lease vs. used'
          : step === 5
            ? 'Cost of ownership & ownership budget'
            : step === 6
              ? 'Auto shopping strategy & recommendations'
              : step === 7
                ? 'Trade-in analysis'
                : 'Trade-in analyzed';

  const stepDescription = step === 1
    ? 'Start with your budget and priorities. Everything else builds from this.'
    : step === 2
      ? 'Review the vehicles below and check the needs that matter to you.'
      : step === 3
        ? 'Enter the vehicle price, down payment, APR, and term to see your monthly payment and total cost.'
        : step === 4
          ? 'Compare buying new, leasing, and buying used side by side. Adjust any number to see how the trade-offs shift.'
          : step === 5
            ? 'Build a realistic monthly ownership budget. Enter your estimated costs for each category.'
            : step === 6
              ? 'Based on your needs, vehicles are grouped into three tiers with strengths, concerns, and next steps.'
              : 'Enter the trade-in value and payoff to see your net equity position.';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">
          Step {step} of 8 — {stepLabel}
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
      ) : (
        <TradeEvaluator onComplete={() => setStep(8)} />
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
            Back to {step === 2 ? 'intake' : step === 3 ? 'vehicles' : step === 4 ? 'financing' : step === 5 ? 'comparison' : step === 6 ? 'ownership budget' : 'shopping strategy'}
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
