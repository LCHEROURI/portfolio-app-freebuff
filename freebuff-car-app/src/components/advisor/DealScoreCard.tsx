'use client';

import { useState, type FormEvent } from 'react';
import { computeDealScore, type DealScoreResult } from '@/utils/dealScoreEngine';

interface DealState {
  monthlyPayment: string;
  monthlyBudget: string;
  docFee: string;
  addOnCount: string;
  prioritiesMet: string;
  priorityCount: string;
  tradeEquity: string;
}

const DEFAULT_STATE: DealState = {
  monthlyPayment: '',
  monthlyBudget: '',
  docFee: '',
  addOnCount: '',
  prioritiesMet: '',
  priorityCount: '',
  tradeEquity: '',
};

function parseNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface Props {
  onComplete?: () => void;
  onSaveData?: (data: unknown) => void;
}

export default function DealScoreCard({ onComplete, onSaveData }: Props = {}) {
  const [state, setState] = useState<DealState>(DEFAULT_STATE);
  const [errors, setErrors] = useState<Partial<DealState>>({});
  const [result, setResult] = useState<DealScoreResult | null>(null);

  function validate(): boolean {
    const nextErrors: Partial<DealState> = {};

    if (!state.monthlyPayment.trim()) nextErrors.monthlyPayment = 'Required.';
    else if (parseNumber(state.monthlyPayment) <= 0) {
      nextErrors.monthlyPayment = 'Must be greater than zero.';
    }

    if (!state.monthlyBudget.trim()) nextErrors.monthlyBudget = 'Required.';
    else if (parseNumber(state.monthlyBudget) <= 0) {
      nextErrors.monthlyBudget = 'Must be greater than zero.';
    }

    if (parseNumber(state.docFee) < 0) nextErrors.docFee = 'Cannot be negative.';
    if (parseNumber(state.addOnCount) < 0) nextErrors.addOnCount = 'Cannot be negative.';
    // Note: negative trade equity is valid input — the engine penalizes it in the score.

    if (
      !nextErrors.prioritiesMet &&
      !nextErrors.priorityCount &&
      parseNumber(state.prioritiesMet) > parseNumber(state.priorityCount)
    ) {
      nextErrors.prioritiesMet = 'Cannot exceed total priorities.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    const nextResult = computeDealScore({
      monthlyPayment: parseNumber(state.monthlyPayment),
      monthlyBudget: parseNumber(state.monthlyBudget),
      docFee: parseNumber(state.docFee),
      addOnCount: parseNumber(state.addOnCount),
      prioritiesMetCount: parseNumber(state.prioritiesMet),
      priorityCount: parseNumber(state.priorityCount),
      tradeEquity: parseNumber(state.tradeEquity),
    });
    setResult(nextResult);
    onSaveData?.({ input: state, result: nextResult });
    onComplete?.();
  }

  function update(field: keyof DealState, value: string) {
    setState((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function scoreColorClass(score: number): string {
    if (score >= 80) return 'border-good-200 bg-good-50 text-good-900';
    if (score >= 60) return 'border-amber-200 bg-amber-50 text-amber-900';
    return 'border-red-200 bg-red-50 text-red-900';
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="monthlyPayment" className="block text-sm font-semibold text-navy-900">
            Monthly payment *
          </label>
          <input
            id="monthlyPayment"
            type="number"
            min="0"
            step="any"
            value={state.monthlyPayment}
            onChange={(e) => update('monthlyPayment', e.target.value)}
            className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:outline-none focus:ring-1 ${errors.monthlyPayment ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200 focus:border-blue-500 focus:ring-blue-500'}`}
            placeholder="450"
          />
          {errors.monthlyPayment && (
            <p className="text-sm text-red-600" role="alert">{errors.monthlyPayment}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="monthlyBudget" className="block text-sm font-semibold text-navy-900">
            Monthly budget *
          </label>
          <input
            id="monthlyBudget"
            type="number"
            min="0"
            step="any"
            value={state.monthlyBudget}
            onChange={(e) => update('monthlyBudget', e.target.value)}
            className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:outline-none focus:ring-1 ${errors.monthlyBudget ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200 focus:border-blue-500 focus:ring-blue-500'}`}
            placeholder="500"
          />
          {errors.monthlyBudget && (
            <p className="text-sm text-red-600" role="alert">{errors.monthlyBudget}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="docFee" className="block text-sm font-semibold text-navy-900">
            Documentation fee
          </label>
          <input
            id="docFee"
            type="number"
            min="0"
            step="any"
            value={state.docFee}
            onChange={(e) => update('docFee', e.target.value)}
            className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:outline-none focus:ring-1 ${errors.docFee ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200 focus:border-blue-500 focus:ring-blue-500'}`}
            placeholder="129"
          />
          {errors.docFee && (
            <p className="text-sm text-red-600" role="alert">{errors.docFee}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="addOnCount" className="block text-sm font-semibold text-navy-900">
            Flagged add-ons
          </label>
          <input
            id="addOnCount"
            type="number"
            min="0"
            step="any"
            value={state.addOnCount}
            onChange={(e) => update('addOnCount', e.target.value)}
            className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:outline-none focus:ring-1 ${errors.addOnCount ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200 focus:border-blue-500 focus:ring-blue-500'}`}
            placeholder="0"
          />
          {errors.addOnCount && (
            <p className="text-sm text-red-600" role="alert">{errors.addOnCount}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="prioritiesMet" className="block text-sm font-semibold text-navy-900">
            Priorities met
          </label>
          <input
            id="prioritiesMet"
            type="number"
            min="0"
            step="any"
            value={state.prioritiesMet}
            onChange={(e) => update('prioritiesMet', e.target.value)}
            className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:outline-none focus:ring-1 ${errors.prioritiesMet ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200 focus:border-blue-500 focus:ring-blue-500'}`}
            placeholder="0"
          />
          {errors.prioritiesMet && (
            <p className="text-sm text-red-600" role="alert">{errors.prioritiesMet}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="priorityCount" className="block text-sm font-semibold text-navy-900">
            Total priorities
          </label>
          <input
            id="priorityCount"
            type="number"
            min="0"
            step="any"
            value={state.priorityCount}
            onChange={(e) => update('priorityCount', e.target.value)}
            className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:outline-none focus:ring-1 ${errors.priorityCount ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200 focus:border-blue-500 focus:ring-blue-500'}`}
            placeholder="0"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="tradeEquity" className="block text-sm font-semibold text-navy-900">
            Trade-in equity
          </label>
          <input
            id="tradeEquity"
            type="number"
            step="any"
            value={state.tradeEquity}
            onChange={(e) => update('tradeEquity', e.target.value)}
            className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:outline-none focus:ring-1 ${errors.tradeEquity ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200 focus:border-blue-500 focus:ring-blue-500'}`}
            placeholder="0"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          Score this deal
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>

      {result && (
        <div className={`rounded-xl border p-6 ${scoreColorClass(result.score)}`}>
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-semibold uppercase tracking-wide opacity-80">Deal score</p>
            <p className="text-3xl font-extrabold" data-testid="deal-score">
              {result.score}
            </p>
          </div>
          <ul className="mt-4 space-y-2" data-testid="score-breakdown">
            {result.breakdown.map((item) => (
              <li key={item.label} className="flex items-start justify-between gap-4">
                <span>
                  <span className="font-semibold">{item.label}</span>
                  <span className="block text-xs opacity-80">{item.reason}</span>
                </span>
                <span className="whitespace-nowrap font-mono">
                  {item.earned} / {item.maxPoints}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
