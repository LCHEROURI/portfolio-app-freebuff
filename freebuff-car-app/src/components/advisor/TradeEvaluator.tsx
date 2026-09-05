'use client';

import { useState, type FormEvent } from 'react';
import { tradeInEquity, isUpsideDown, tradePosition } from '@/utils/tradeInEquity';

interface TradeState {
  tradeValue: string;
  payoff: string;
}

const DEFAULT_STATE: TradeState = {
  tradeValue: '',
  payoff: '0',
};

function parseNonNegative(value: string): number {
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

export default function TradeEvaluator({ onComplete, onSaveData }: Props = {}) {
  const [state, setState] = useState<TradeState>(DEFAULT_STATE);
  const [errors, setErrors] = useState<Partial<TradeState>>({});
  const [result, setResult] = useState<null | {
    equity: number;
    position: 'positive' | 'even' | 'negative';
    upsideDown: boolean;
  }>(null);

  const tradeValue = parseNonNegative(state.tradeValue);
  const payoff = parseNonNegative(state.payoff);

  function validate(): boolean {
    const nextErrors: Partial<TradeState> = {};

    if (!state.tradeValue || state.tradeValue.trim() === '') {
      nextErrors.tradeValue = 'Required.';
    } else if (Number(state.tradeValue) < 0 || !Number.isFinite(Number(state.tradeValue))) {
      nextErrors.tradeValue = 'Cannot be negative.';
    }

    if (!state.payoff || state.payoff.trim() === '') {
      nextErrors.payoff = 'Required.';
    } else if (Number(state.payoff) < 0 || !Number.isFinite(Number(state.payoff))) {
      nextErrors.payoff = 'Cannot be negative.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    const equity = tradeInEquity(tradeValue, payoff);
    setResult({
      equity,
      position: tradePosition(tradeValue, payoff),
      upsideDown: isUpsideDown(tradeValue, payoff),
    });
    onSaveData?.(state);
    onComplete?.();
  }

  function update(field: keyof TradeState, value: string) {
    setState((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="tradeValue" className="block text-sm font-semibold text-navy-900">
            Trade-in value *
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
            <input
              id="tradeValue"
              type="number"
              min="0"
              step="any"
              value={state.tradeValue}
              onChange={(e) => update('tradeValue', e.target.value)}
              className={`block w-full rounded-lg border bg-white pl-7 pr-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${errors.tradeValue ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200'}`}
              placeholder="8000"
              aria-invalid={!!errors.tradeValue}
              aria-describedby={errors.tradeValue ? 'tradeValue-error' : undefined}
            />
          </div>
          {errors.tradeValue && (
            <p id="tradeValue-error" className="text-xs text-red-600">{errors.tradeValue}</p>
          )}
          <p className="text-xs text-ink-500">What the dealer offers for your current car.</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="payoff" className="block text-sm font-semibold text-navy-900">
            Outstanding payoff *
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
            <input
              id="payoff"
              type="number"
              min="0"
              step="any"
              value={state.payoff}
              onChange={(e) => update('payoff', e.target.value)}
              className={`block w-full rounded-lg border bg-white pl-7 pr-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${errors.payoff ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200'}`}
              placeholder="0"
              aria-invalid={!!errors.payoff}
              aria-describedby={errors.payoff ? 'payoff-error' : undefined}
            />
          </div>
          {errors.payoff && (
            <p id="payoff-error" className="text-xs text-red-600">{errors.payoff}</p>
          )}
          <p className="text-xs text-ink-500">What you still owe on your current loan (0 if owned outright).</p>
        </div>
      </div>

      {result && (
        <div
          className={`rounded-xl border p-6 ${
            result.position === 'negative'
              ? 'border-red-200 bg-red-50'
              : result.position === 'positive'
                ? 'border-good-200 bg-good-50'
                : 'border-ink-200 bg-ink-50'
          }`}
        >
          <p className="font-semibold text-navy-900">
            {result.position === 'positive' && 'You have positive equity'}
            {result.position === 'even' && 'Your trade is even'}
            {result.position === 'negative' && 'You are upside down on your loan'}
          </p>
          <p className="mt-1 text-sm text-ink-700">
            Net equity:{' '}
            <span className={`font-semibold ${result.equity >= 0 ? 'text-good-700' : 'text-red-700'}`}>
              {result.equity >= 0 ? '+' : '-'}{formatCurrency(Math.abs(result.equity))}
            </span>
          </p>
          {result.upsideDown && (
            <p className="mt-3 rounded-lg bg-red-100 px-4 py-3 text-sm font-medium text-red-800">
              ⚠️ Upside-down warning: the payoff exceeds the trade value. Rolling this into a new loan
              increases what you finance — consider paying the difference in cash or waiting.
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          Analyze trade
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </form>
  );
}
