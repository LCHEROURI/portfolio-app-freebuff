'use client';

import { useState, type FormEvent } from 'react';
import { monthlyPayment, totalCost } from '@/utils/financeCalculators';

interface ComparisonInput {
  newPrice: string;
  newDown: string;
  newApr: string;
  newTerm: string;
  leaseMonthly: string;
  leaseDueAtSigning: string;
  leaseTerm: string;
  leaseMileage: string;
  usedPrice: string;
  usedDown: string;
  usedApr: string;
  usedTerm: string;
  usedMiles: string;
}

const DEFAULT_INPUT: ComparisonInput = {
  newPrice: '30000',
  newDown: '5000',
  newApr: '6',
  newTerm: '60',
  leaseMonthly: '399',
  leaseDueAtSigning: '2500',
  leaseTerm: '36',
  leaseMileage: '12000',
  usedPrice: '20000',
  usedDown: '3000',
  usedApr: '7',
  usedTerm: '48',
  usedMiles: '45000',
};

const TERM_OPTIONS = [
  { value: '24', label: '24 months' },
  { value: '36', label: '36 months' },
  { value: '48', label: '48 months' },
  { value: '60', label: '60 months' },
  { value: '72', label: '72 months' },
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

type OptionType = 'buyNew' | 'lease' | 'buyUsed';

interface OptionResult {
  type: OptionType;
  label: string;
  monthly: number;
  totalCost: number;
  upfront: number;
  termMonths: number;
  summary: string;
}

function computeBuyNew(input: ComparisonInput): OptionResult {
  const price = parsePositive(input.newPrice);
  const down = parsePositive(input.newDown);
  const apr = parsePositive(input.newApr);
  const term = parsePositive(input.newTerm);
  const loan = Math.max(0, price - down);
  const payment = term > 0 ? monthlyPayment(loan, apr, term) : 0;
  const total = term > 0 ? totalCost(loan, apr, term) : 0;
  return {
    type: 'buyNew',
    label: 'Buy New',
    monthly: payment,
    totalCost: total + down,
    upfront: down,
    termMonths: term,
    summary: `${price > 0 ? formatCurrency(price) : '—'} new at ${apr}% APR for ${term} months`,
  };
}

function computeLease(input: ComparisonInput): OptionResult {
  const monthly = parsePositive(input.leaseMonthly);
  const dueAtSigning = parsePositive(input.leaseDueAtSigning);
  const term = parsePositive(input.leaseTerm);
  const total = monthly * term + dueAtSigning;
  return {
    type: 'lease',
    label: 'Lease',
    monthly,
    totalCost: total,
    upfront: dueAtSigning,
    termMonths: term,
    summary: `${formatCurrency(monthly)}/month × ${term} months, ${input.leaseMileage} mi/yr allowance`,
  };
}

function computeBuyUsed(input: ComparisonInput): OptionResult {
  const price = parsePositive(input.usedPrice);
  const down = parsePositive(input.usedDown);
  const apr = parsePositive(input.usedApr);
  const term = parsePositive(input.usedTerm);
  const loan = Math.max(0, price - down);
  const payment = term > 0 ? monthlyPayment(loan, apr, term) : 0;
  const total = term > 0 ? totalCost(loan, apr, term) : 0;
  return {
    type: 'buyUsed',
    label: 'Buy Used',
    monthly: payment,
    totalCost: total + down,
    upfront: down,
    termMonths: term,
    summary: `${formatCurrency(price)} used at ${apr}% APR for ${term} months (~${input.usedMiles} mi)`,
  };
}

export default function LeaseMatrix({ onComplete }: { onComplete?: () => void } = {}) {
  const [input, setInput] = useState<ComparisonInput>(DEFAULT_INPUT);
  const [submitted, setSubmitted] = useState(false);

  function update(field: keyof ComparisonInput, value: string) {
    setInput((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    onComplete?.();
  }

  const buyNew = computeBuyNew(input);
  const lease = computeLease(input);
  const buyUsed = computeBuyUsed(input);

  const options: OptionResult[] = [buyNew, lease, buyUsed];
  const cheapestMonthly = Math.min(buyNew.monthly, lease.monthly, buyUsed.monthly);
  const cheapestTotal = Math.min(buyNew.totalCost, lease.totalCost, buyUsed.totalCost);

  if (submitted) {
    return (
      <div className="rounded-xl border border-good-200 bg-good-50 p-6">
        <div className="flex items-start gap-3">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-good-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="font-semibold text-good-900">Comparison complete</p>
            <p className="mt-1 text-sm text-good-800">
              See the full matrix below for monthly and total cost across all three options.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-navy-900">Step 4 of 8 — Buy vs. Lease vs. Used</h2>
        <p className="mt-1 text-ink-600">
          Compare buying new, leasing, and buying used side by side. Adjust any number to see how the trade-offs
          shift.
        </p>
      </div>

      {/* Buy New inputs */}
      <fieldset className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
        <legend className="mb-4 text-sm font-semibold text-navy-900">Buy New</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <label htmlFor="newPrice" className="text-sm font-medium text-ink-700">Price *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
              <input
                id="newPrice"
                type="number"
                min="0"
                step="500"
                value={input.newPrice}
                onChange={(e) => update('newPrice', e.target.value)}
                className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="30000"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="newDown" className="text-sm font-medium text-ink-700">Down payment *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
              <input
                id="newDown"
                type="number"
                min="0"
                step="500"
                value={input.newDown}
                onChange={(e) => update('newDown', e.target.value)}
                className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="5000"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="newApr" className="text-sm font-medium text-ink-700">APR *</label>
            <input
              id="newApr"
              type="number"
              min="0"
              max="30"
              step="0.1"
              value={input.newApr}
              onChange={(e) => update('newApr', e.target.value)}
              className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="6"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="newTerm" className="text-sm font-medium text-ink-700">Term *</label>
            <select
              id="newTerm"
              value={input.newTerm}
              onChange={(e) => update('newTerm', e.target.value)}
              className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {TERM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      {/* Lease inputs */}
      <fieldset className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
        <legend className="mb-4 text-sm font-semibold text-navy-900">Lease</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <label htmlFor="leaseMonthly" className="text-sm font-medium text-ink-700">Monthly payment *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
              <input
                id="leaseMonthly"
                type="number"
                min="0"
                step="10"
                value={input.leaseMonthly}
                onChange={(e) => update('leaseMonthly', e.target.value)}
                className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="399"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="leaseDueAtSigning" className="text-sm font-medium text-ink-700">Due at signing *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
              <input
                id="leaseDueAtSigning"
                type="number"
                min="0"
                step="500"
                value={input.leaseDueAtSigning}
                onChange={(e) => update('leaseDueAtSigning', e.target.value)}
                className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="2500"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="leaseTerm" className="text-sm font-medium text-ink-700">Lease term *</label>
            <select
              id="leaseTerm"
              value={input.leaseTerm}
              onChange={(e) => update('leaseTerm', e.target.value)}
              className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {TERM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="leaseMileage" className="text-sm font-medium text-ink-700">Annual mileage</label>
            <input
              id="leaseMileage"
              type="number"
              min="0"
              step="1000"
              value={input.leaseMileage}
              onChange={(e) => update('leaseMileage', e.target.value)}
              className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="12000"
            />
          </div>
        </div>
      </fieldset>

      {/* Buy Used inputs */}
      <fieldset className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
        <legend className="mb-4 text-sm font-semibold text-navy-900">Buy Used</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <label htmlFor="usedPrice" className="text-sm font-medium text-ink-700">Price *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
              <input
                id="usedPrice"
                type="number"
                min="0"
                step="500"
                value={input.usedPrice}
                onChange={(e) => update('usedPrice', e.target.value)}
                className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="20000"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="usedDown" className="text-sm font-medium text-ink-700">Down payment *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
              <input
                id="usedDown"
                type="number"
                min="0"
                step="500"
                value={input.usedDown}
                onChange={(e) => update('usedDown', e.target.value)}
                className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="3000"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="usedApr" className="text-sm font-medium text-ink-700">APR *</label>
            <input
              id="usedApr"
              type="number"
              min="0"
              max="30"
              step="0.1"
              value={input.usedApr}
              onChange={(e) => update('usedApr', e.target.value)}
              className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="7"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="usedTerm" className="text-sm font-medium text-ink-700">Term *</label>
            <select
              id="usedTerm"
              value={input.usedTerm}
              onChange={(e) => update('usedTerm', e.target.value)}
              className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {TERM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <label htmlFor="usedMiles" className="text-sm font-medium text-ink-700">Estimated miles on odometer *</label>
          <input
            id="usedMiles"
            type="number"
            min="0"
            step="5000"
            value={input.usedMiles}
            onChange={(e) => update('usedMiles', e.target.value)}
            className="mt-1 block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="45000"
          />
        </div>
      </fieldset>

      {/* Summary table */}
      <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-navy-900">Side-by-side comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200">
                <th className="px-3 py-2 text-left font-semibold text-ink-700">Option</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-700">Upfront</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-700">Monthly</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-700">Total cost</th>
                <th className="px-3 py-2 text-left font-semibold text-ink-700">Notes</th>
              </tr>
            </thead>
            <tbody>
              {options.map((opt) => (
                <tr key={opt.type} className="border-b border-ink-100">
                  <td className="px-3 py-2">
                    <span className="font-semibold text-navy-900">{opt.label}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-ink-700">{formatCurrency(opt.upfront)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`font-semibold ${opt.monthly === cheapestMonthly ? 'text-good-700' : 'text-ink-900'}`}>
                      {formatCurrencyCents(opt.monthly)}
                      {opt.monthly === cheapestMonthly ? ' ▼' : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={`font-semibold ${opt.totalCost === cheapestTotal ? 'text-good-700' : 'text-ink-900'}`}>
                      {formatCurrency(opt.totalCost)}
                      {opt.totalCost === cheapestTotal ? ' ▼' : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-500">{opt.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-500">
          <span className="rounded-full bg-ink-100 px-2.5 py-1">▼ = lowest in column</span>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => setSubmitted(false)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink-100 px-4 py-2 text-sm font-medium text-ink-700 shadow-sm transition-colors hover:bg-ink-200"
        >
          Reset to defaults
        </button>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          Save comparison
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </form>
  );
}
