'use client';

import React from 'react';
import { estimateMonthlyPayment, maxPriceForBudget } from '@/lib/affordability';
import { useState, type FormEvent } from 'react';

export type CreditRange = 'poor' | 'fair' | 'good' | 'excellent';

export interface IntakeState {
  monthlyBudget: string;
  downPayment: string;
  creditRange: CreditRange | '';
  zip: string;
  bodyStyle: string;
  phase: number;
}

// Error state uses string messages; the form state uses CreditRange | ''.
type IntakeFieldErrors = Partial<Record<keyof IntakeState, string>>;

const DEFAULT_STATE: IntakeState = {
  monthlyBudget: '',
  downPayment: '',
  creditRange: '',
  zip: '',
  bodyStyle: '',
  phase: 1,
};

function parsePositive(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

interface Props {
  onComplete?: () => void;
  onSaveData?: (data: unknown) => void;
}

export default function IntakeForm({ onComplete, onSaveData }: Props = {}) {
  const [state, setState] = useState<IntakeState>(DEFAULT_STATE);
  const [errors, setErrors] = useState<IntakeFieldErrors>({});
  const [submitted, setSubmitted] = useState(false);

  function validate(): boolean {
    const nextErrors: IntakeFieldErrors = {};

    const budget = parsePositive(state.monthlyBudget);
    if (!state.monthlyBudget || state.monthlyBudget.trim() === '') {
      nextErrors.monthlyBudget = 'Monthly budget is required.';
    } else if (budget <= 0) {
      nextErrors.monthlyBudget = 'Monthly budget must be greater than zero.';
    }

    const down = parsePositive(state.downPayment);
    if (!state.downPayment || state.downPayment.trim() === '') {
      nextErrors.downPayment = 'Down payment is required.';
    } else if (down < 0) {
      nextErrors.downPayment = 'Down payment cannot be negative.';
    }

    if (!state.creditRange) {
      nextErrors.creditRange = 'Credit range is required.';
    }

    if (state.zip.trim() !== '' && !/^\d{5}$/.test(state.zip.trim())) {
      nextErrors.zip = 'ZIP must be 5 digits.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitted(true);
    onSaveData?.(state);
    onComplete?.();
  }

  function update(field: keyof IntakeState, value: string) {
    setState((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-good-200 bg-good-50 p-6">
        <div className="flex items-start gap-3">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-good-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="font-semibold text-good-900">Got it — your budget is set</p>
            <p className="mt-1 text-sm text-good-800">
              Monthly budget: <strong>{formatCurrency(parsePositive(state.monthlyBudget))}</strong>
              {' '}· Down payment: <strong>{formatCurrency(parsePositive(state.downPayment))}</strong>
              {' '}· Credit: <strong>{state.creditRange}</strong>
              {state.zip.trim() !== '' && (
                <>
                  {' '}· ZIP: <strong>{state.zip.trim()}</strong>
                </>
              )}
              {state.bodyStyle !== '' && (
                <>
                  {' '}· Body style: <strong>{state.bodyStyle}</strong>
                </>
              )}
            </p>
            <p className="mt-2 text-sm text-ink-600">
              Now let us rank what matters most to you.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const budgetNum = parsePositive(state.monthlyBudget);
  const downNum = parsePositive(state.downPayment);
  const ceiling =
    budgetNum > 0
      ? maxPriceForBudget({ monthlyBudget: budgetNum, downPayment: downNum, creditRange: state.creditRange })
      : null;
  const ceilingFits =
    ceiling !== null &&
    ((estimateMonthlyPayment({ price: ceiling, downPayment: downNum, creditRange: state.creditRange }) ?? Infinity) <=
      budgetNum);
  const sliderValue = budgetNum <= 0 ? 100 : Math.min(2000, Math.max(100, Math.round(budgetNum / 25) * 25));

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-1.5">
        <label htmlFor="monthlyBudget" className="block text-sm font-semibold text-navy-900">
          Monthly budget *
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
          <input
            id="monthlyBudget"
            type="number"
            min="0"
            step="any"
            value={state.monthlyBudget}
            onChange={(e) => update('monthlyBudget', e.target.value)}
            className={`block w-full rounded-lg border bg-white pl-7 pr-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${errors.monthlyBudget ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200'}`}
            placeholder="4500"
            aria-invalid={!!errors.monthlyBudget}
            aria-describedby={errors.monthlyBudget ? 'monthlyBudget-error' : undefined}
          />
        </div>
        {errors.monthlyBudget && (
          <p id="monthlyBudget-error" className="text-xs text-red-600">{errors.monthlyBudget}</p>
        )}
        <p className="text-xs text-ink-500">What can you comfortably spend per month?</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="downPayment" className="block text-sm font-semibold text-navy-900">
          Desired down payment *
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
          <input
            id="downPayment"
            type="number"
            min="0"
            step="any"
            value={state.downPayment}
            onChange={(e) => update('downPayment', e.target.value)}
            className={`block w-full rounded-lg border bg-white pl-7 pr-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${errors.downPayment ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200'}`}
            placeholder="5000"
            aria-invalid={!!errors.downPayment}
            aria-describedby={errors.downPayment ? 'downPayment-error' : undefined}
          />
        </div>
        {errors.downPayment && (
          <p id="downPayment-error" className="text-xs text-red-600">{errors.downPayment}</p>
        )}
        <p className="text-xs text-ink-500">Cash you plan to put down upfront.</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="zip" className="block text-sm font-semibold text-navy-900">
          ZIP code (optional)
        </label>
        <input
          id="zip"
          type="text"
          inputMode="numeric"
          maxLength={5}
          value={state.zip}
          onChange={(e) => update('zip', e.target.value.replace(/\D/g, ''))}
          className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${errors.zip ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200'}`}
          placeholder="60601"
          aria-invalid={!!errors.zip}
          aria-describedby={errors.zip ? 'zip-error' : undefined}
        />
        {errors.zip && (
          <p id="zip-error" className="text-xs text-red-600">{errors.zip}</p>
        )}
        <p className="text-xs text-ink-500">Narrows the inventory search to dealers near you.</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="bodyStyle" className="block text-sm font-semibold text-navy-900">
          Body style (optional)
        </label>
        <select
          id="bodyStyle"
          value={state.bodyStyle}
          onChange={(e) => update('bodyStyle', e.target.value)}
          className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Any body style</option>
          <option value="sedan">Sedan</option>
          <option value="suv">SUV</option>
          <option value="crossover">Crossover</option>
          <option value="hatchback">Hatchback</option>
          <option value="pickup">Pickup</option>
          <option value="minivan">Minivan</option>
          <option value="wagon">Wagon</option>
          <option value="coupe">Coupe</option>
        </select>
        <p className="text-xs text-ink-500">Filters the live inventory feed by vehicle type.</p>
      </div>

      <fieldset>
        <legend className="block text-sm font-semibold text-navy-900">
          Credit score range *
        </legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['poor', 'fair', 'good', 'excellent'] as CreditRange[]).map((range) => (
            <label
              key={range}
              className={`relative cursor-pointer rounded-lg border bg-white px-3 py-2.5 text-center text-sm shadow-sm transition-colors ${state.creditRange === range ? 'border-blue-500 bg-blue-50 text-blue-800 font-semibold' : 'border-ink-200 text-ink-700 hover:border-ink-300'}`}
            >
              <input
                type="radio"
                name="creditRange"
                value={range}
                checked={state.creditRange === range}
                onChange={(e) => update('creditRange', e.target.value)}
                className="sr-only"
              />
              {range.charAt(0).toUpperCase() + range.slice(1)}
            </label>
          ))}
        </div>
        {errors.creditRange && (
          <p className="text-xs text-red-600">{errors.creditRange}</p>
        )}
      </fieldset>

      {budgetNum > 0 && (
        <div
          data-testid="ceiling-panel"
          aria-live="polite"
          className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm"
        >
          <p className="font-semibold text-blue-900">
            {ceiling !== null
              ? <>Your budget supports roughly {formatCurrency(ceiling)} in vehicle price</>
              : 'Your monthly budget is too small to estimate a price ceiling'}
          </p>
          <p className="mt-0.5 text-xs text-blue-800">
            {state.creditRange
              ? <>Assumes a 60-month loan at {state.creditRange} credit, plus an allowance for sales tax and fees.</>
              : 'Assumes good credit for now — pick your credit range for a precise estimate.'}
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="budgetSlider" className="block text-xs font-semibold text-ink-700">
          Budget explorer
        </label>
        <input
          id="budgetSlider"
          data-testid="budget-slider"
          type="range"
          min={100}
          max={2000}
          step={25}
          value={sliderValue}
          onChange={(e) => update('monthlyBudget', e.target.value)}
          className={`w-full ${ceilingFits ? 'accent-good-600' : 'accent-amber-600'}`}
        />
        <p className="text-xs text-ink-500">
          Drag to explore — the ceiling updates live and nothing is saved until you submit the form.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          Save & continue
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </form>
  );
}
