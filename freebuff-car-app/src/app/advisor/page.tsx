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
import { useEffect, useState } from 'react';
import { useAdvisorState } from '@/hooks/useAdvisorState';
import type { AdvisorState } from '@/hooks/useAdvisorState';
import { STEP_LABELS, type Step } from '@/lib/steps';
import StepProgress from '@/components/StepProgress';

interface VersionBody {
  service?: string;
  commit?: string | null;
  rolloutId?: string | null;
  deployedAt?: string | null;
}

function prettyDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' UTC';
}

function VersionMarker() {
  const [version, setVersion] = useState<VersionBody | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/version', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then(setVersion)
      .catch((e) => setErr(String(e)));
  }, []);

  if (!version) return null;

  const sha = version.commit;
  return (
    <div className="mt-4 rounded-xl border border-ink-200 bg-white/80 px-4 py-3 text-sm shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Serving this build</p>
      <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
        <span className="font-semibold text-navy-900">
          {sha ? (
            <a
              href={`https://github.com/LCHEROURI/portfolio-app-freebuff/commit/${sha}`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-700 underline decoration-blue-200 underline-offset-2 hover:text-blue-800"
            >
              {sha}
            </a>
          ) : (
            <span className="text-amber-700">dev build</span>
          )}
          {version.service ? ` · ${version.service}` : ''}
        </span>
        {version.rolloutId ? (
          <span className="text-ink-600">rollout {version.rolloutId}</span>
        ) : (
          <span className="text-ink-400">no rollout id</span>
        )}
        {version.deployedAt ? (
          <span className="text-ink-600">deployed {prettyDate(version.deployedAt)}</span>
        ) : (
          <span className="text-ink-400">no deploy time</span>
        )}
        {err ? (
          <span className="text-red-600">version check failed: {err}</span>
        ) : null}
      </div>
    </div>
  );
}

const BACK_LABELS: Partial<Record<Step, string>> = {
  2: 'intake',
  3: 'vehicles',
  4: 'financing',
  5: 'comparison',
  6: 'ownership budget',
  7: 'shopping strategy',
  8: 'trade-in',
  9: 'fee audit',
  10: 'negotiation script',
  11: 'deal score',
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
  const { state: advisorState, update: updateAdvisorState, reset: resetAdvisorState, hydrated } = useAdvisorState();
  const [step, setStep] = useState<Step>(1);

  // Restore the saved step once the hook has hydrated from localStorage.
  // Runs only when `hydrated` flips, so later in-session steps are not overwritten.
  useEffect(() => {
    if (hydrated && advisorState.step >= 1 && advisorState.step <= 11) {
      setStep(advisorState.step as Step);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const goToStep = (s: Step) => {
    setStep(s);
    updateAdvisorState({ step: s });
  };

  const saveData = (key: keyof Omit<AdvisorState, 'step' | 'consent'>) => (data: unknown) => {
    updateAdvisorState({ [key]: data } as Partial<AdvisorState>);
  };

  // Suggested MSRP for Step 3: the first compared vehicle's saved specs
  // snapshot (Step 2). A previously saved finance price overrides it via
  // FinanceCalc's prefill logic.
  const compared = Array.isArray(advisorState.vehicles?.comparing)
    ? (advisorState.vehicles?.comparing as string[])
    : [];
  const specs = (advisorState.vehicles?.specs ?? {}) as Record<string, { msrp?: number } | undefined>;
  const suggestedMSRP = compared.length > 0 ? (specs[compared[0]]?.msrp ?? null) : null;
  const suggestedLabel = compared.length > 0
    ? ((advisorState.vehicles?.names ?? {}) as Record<string, string>)[compared[0]]
    : undefined;

  const stepLabel = STEP_LABELS[step];

  const stepDescription = STEP_DESCRIPTIONS[step];

  // On the report step, printing is the app's one printable artifact: the
  // Intelligence Report. Its own chrome is already print:hidden, so the
  // page shell around it (step header + progress, bottom nav, deploy
  // marker) must not leak into the printed page — see Prompt 11.
  const printHideChrome = step === 11 ? 'print:hidden' : '';

  return (
    <div className="space-y-6">
      <div data-testid="advisor-chrome" className={`flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${printHideChrome}`}>
        <div>
          <h1 className="text-2xl font-bold text-navy-900">
            Step {step} of 11 — {stepLabel}
          </h1>
          <p className="mt-1 text-ink-600">{stepDescription}</p>
          {step === 1 && <VersionMarker />}
        </div>
        <StepProgress advisor={advisorState} />
      </div>

      {step === 1 ? (
        <IntakeForm onComplete={() => goToStep(2)} onSaveData={saveData('intake')} />
      ) : step === 2 ? (
        <VehicleNeeds onContinue={() => goToStep(3)} intake={advisorState.intake} onSaveData={saveData('vehicles')} />
      ) : step === 3 ? (
        <FinanceCalc
          onComplete={() => goToStep(4)}
          onSaveData={saveData('finance')}
          suggestedMSRP={suggestedMSRP}
          suggestedLabel={suggestedLabel}
        />
      ) : step === 4 ? (
        <LeaseMatrix onComplete={() => goToStep(5)} onSaveData={saveData('lease')} />
      ) : step === 5 ? (
        <OwnershipBudget onComplete={() => goToStep(6)} onSaveData={saveData('ownership')} />
      ) : step === 6 ? (
        <ShoppingStrategy onContinue={() => goToStep(7)} />
      ) : step === 7 ? (
        <TradeEvaluator onComplete={() => goToStep(8)} onSaveData={saveData('trade')} />
      ) : step === 8 ? (
        <FeeAuditor onComplete={() => goToStep(9)} onSaveData={saveData('fees')} />
      ) : step === 9 ? (
        <DriveScript onComplete={() => goToStep(10)} />
      ) : step === 10 ? (
        <DealScoreCard onComplete={() => goToStep(11)} onSaveData={saveData('dealScore')} />
      ) : (
        <IntelligenceReport
          advisor={advisorState}
          onComplete={() => updateAdvisorState({})}
          onReset={() => {
            resetAdvisorState();
            setStep(1);
          }}
        />
      )}

      <div data-testid="advisor-nav" className={`flex items-center justify-between pt-4 ${printHideChrome}`}>
        {step > 1 && (
          <button
            type="button"
            onClick={() => goToStep(Math.max(1, step - 1) as Step)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink-100 px-4 py-2 text-sm font-medium text-ink-700 shadow-sm transition-colors hover:bg-ink-200"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to {BACK_LABELS[step as Step]}
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
      <p data-testid="advisor-footer" className={`pt-2 text-center text-xs text-ink-400 ${printHideChrome}`}>
        freebuff-car-app deploy marker — a fresh push confirms the rollout pipeline end to end
      </p>
    </div>
  );
}
