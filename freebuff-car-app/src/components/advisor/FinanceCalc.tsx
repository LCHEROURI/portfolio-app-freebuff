'use client';

import { useState, type FormEvent } from 'react';
import {
  monthlyPayment,
  totalInterest,
  totalCost,
} from '@/utils/financeCalculators';

interface FinanceState {
  vehiclePrice: string;
  downPayment: string;
  apr: string;
  termMonths: string;
}

const DEFAULT_STATE: FinanceState = {
  vehiclePrice: '',
  downPayment: '',
  apr: '',
  termMonths: '60',
};

const TERM_OPTIONS = [
  { value: '24', label: '24 months (2 years)' },
  { value: '36', label: '36 months (3 years)' },
  { value: '48', label: '48 months (4 years)' },
  { value: '60', label: '60 months (5 years)' },
  { value: '72', label: '72 months (6 years)' },
  { value: '84', label: '84 months (7 years)' },
];

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

function formatCurrencyCents(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

interface Props {
  onComplete?: () => void;
  onSaveData?: (data: unknown) => void;
}

export default function FinanceCalc({ onComplete, onSaveData }: Props = {}) {
  const [state, setState] = useState<FinanceState>(DEFAULT_STATE);
  const [errors, setErrors] = useState<Partial<FinanceState>>({});
  const [submitted, setSubmitted] = useState(false);

  function validate(): boolean {
    const nextErrors: Partial<FinanceState> = {};

    const price = parsePositive(state.vehiclePrice);
    if (!state.vehiclePrice || state.vehiclePrice.trim() === '') {
      nextErrors.vehiclePrice = 'Vehicle price is required.';
    } else if (price <= 0) {
      nextErrors.vehiclePrice = 'Vehicle price must be greater than zero.';
    }

    const down = parsePositive(state.downPayment);
    if (!state.downPayment || state.downPayment.trim() === '') {
      nextErrors.downPayment = 'Down payment is required.';
    } else if (down < 0) {
      nextErrors.downPayment = 'Down payment cannot be negative.';
    } else if (down > price) {
      nextErrors.downPayment = 'Down payment cannot exceed vehicle price.';
    }

    const apr = parsePositive(state.apr);
    if (!state.apr || state.apr.trim() === '') {
      nextErrors.apr = 'APR is required.';
    } else if (apr < 0) {
      nextErrors.apr = 'APR cannot be negative.';
    }

    const term = parsePositive(state.termMonths);
    if (!state.termMonths || state.termMonths.trim() === '') {
      nextErrors.termMonths = 'Loan term is required.';
    } else if (term <= 0) {
      nextErrors.termMonths = 'Loan term must be greater than zero.';
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

  function update(field: keyof FinanceState, value: string) {
    setState((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  const price = parsePositive(state.vehiclePrice);
  const down = parsePositive(state.downPayment);
  const apr = parsePositive(state.apr);
  const term = parsePositive(state.termMonths);
  const loanAmount = Math.max(0, price - down);
  const payment = term > 0 ? monthlyPayment(loanAmount, apr, term) : 0;
  const interest = term > 0 ? totalInterest(loanAmount, apr, term) : 0;
  const cost = term > 0 ? totalCost(loanAmount, apr, term) : 0;

  if (submitted) {
    return (
      <div className="rounded-xl border border-good-200 bg-good-50 p-6">
        <div className="flex items-start gap-3">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-good-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="font-semibold text-good-900">Your financing numbers are ready</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-xs text-good-800">Loan amount</p>
                <p className="text-lg font-semibold text-good-900">{formatCurrency(loanAmount)}</p>
              </div>
              <div>
                <p className="text-xs text-good-800">Monthly payment</p>
                <p className="text-lg font-semibold text-good-900">{formatCurrencyCents(payment)}</p>
              </div>
              <div>
                <p className="text-xs text-good-800">Total interest</p>
                <p className="text-lg font-semibold text-good-900">{formatCurrency(interest)}</p>
              </div>
              <div>
                <p className="text-xs text-good-800">Total cost</p>
                <p className="text-lg font-semibold text-good-900">{formatCurrency(cost)}</p>
              </div>
              <div>
                <p className="text-xs text-good-800">APR</p>
                <p className="text-lg font-semibold text-good-900">{apr}%</p>
              </div>
              <div>
                <p className="text-xs text-good-800">Term</p>
                <p className="text-lg font-semibold text-good-900">{term} months</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-1.5">
        <label htmlFor="vehiclePrice" className="block text-sm font-semibold text-navy-900">
          Vehicle price *
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
          <input
            id="vehiclePrice"
            type="number"
            min="0"
            step="any"
            value={state.vehiclePrice}
            onChange={(e) => update('vehiclePrice', e.target.value)}
            className={`block w-full rounded-lg border bg-white pl-7 pr-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${errors.vehiclePrice ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200'}`}
            placeholder="30000"
            aria-invalid={!!errors.vehiclePrice}
            aria-describedby={errors.vehiclePrice ? 'vehiclePrice-error' : undefined}
          />
        </div>
        {errors.vehiclePrice && (
          <p id="vehiclePrice-error" className="text-xs text-red-600">{errors.vehiclePrice}</p>
        )}
        <p className="text-xs text-ink-500">Sticker price before taxes and fees.</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="downPayment" className="block text-sm font-semibold text-navy-900">
          Down payment *
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
        <p className="text-xs text-ink-500">Cash you put down upfront. Cannot exceed vehicle price.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="apr" className="block text-sm font-semibold text-navy-900">
            APR (annual interest rate) *
          </label>
          <input
            id="apr"
            type="number"
            min="0"
            max="30"
            step="any"
            value={state.apr}
            onChange={(e) => update('apr', e.target.value)}
            className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${errors.apr ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200'}`}
            placeholder="6.5"
            aria-invalid={!!errors.apr}
            aria-describedby={errors.apr ? 'apr-error' : undefined}
          />
          {errors.apr && (
            <p id="apr-error" className="text-xs text-red-600">{errors.apr}</p>
          )}
          <p className="text-xs text-ink-500">Enter as a percentage, e.g. 6.5 for 6.5%. Use 0 for 0% APR.</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="termMonths" className="block text-sm font-semibold text-navy-900">
            Loan term *
          </label>
          <select
            id="termMonths"
            value={state.termMonths}
            onChange={(e) => update('termMonths', e.target.value)}
            className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${errors.termMonths ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200'}`}
            aria-invalid={!!errors.termMonths}
          >
            {TERM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {errors.termMonths && (
            <p className="text-xs text-red-600">{errors.termMonths}</p>
          )}
        </div>
      </div>

      {/* Live preview */}
      {price > 0 && down >= 0 && term > 0 && (
        <div className="rounded-xl border border-ink-200 bg-ink-50 p-5">
          <p className="text-sm font-semibold text-navy-900">Live preview</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs text-ink-500">Loan amount</p>
              <p className="text-base font-semibold text-ink-900">{formatCurrency(loanAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Estimated monthly</p>
              <p className="text-base font-semibold text-ink-900">{formatCurrencyCents(payment)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Total interest</p>
              <p className="text-base font-semibold text-ink-900">{formatCurrency(interest)}</p>
            </div>
          </div>
          {down > price && (
            <p className="mt-2 text-xs text-red-600">Down payment exceeds vehicle price — adjust one of them.</p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          Calculate
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </form>
  );
}
