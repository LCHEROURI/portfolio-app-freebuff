'use client';

import { useState, type FormEvent } from 'react';
import { quoteRedFlags, type RedFlag } from '@/utils/redFlags';

interface FeeState {
  docFee: string;
  titleRegistration: string;
  addOnsText: string;
}

const DEFAULT_STATE: FeeState = {
  docFee: '129',
  titleRegistration: '345',
  addOnsText: 'Fabric Protection, Nitrogen Tires, Glass Etching',
};

const DOC_FEE_THRESHOLD = 150;

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

function parseAddOns(text: string): string[] {
  return text
    .split(/[,\n;]/)
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

interface Props {
  onComplete?: () => void;
}

export default function FeeAuditor({ onComplete }: Props = {}) {
  const [state, setState] = useState<FeeState>(DEFAULT_STATE);
  const [errors, setErrors] = useState<Partial<FeeState>>({});
  const [flags, setFlags] = useState<RedFlag[] | null>(null);

  function validate(): boolean {
    const nextErrors: Partial<FeeState> = {};

    if (!state.docFee || state.docFee.trim() === '') {
      nextErrors.docFee = 'Required.';
    } else if (Number(state.docFee) < 0 || !Number.isFinite(Number(state.docFee))) {
      nextErrors.docFee = 'Cannot be negative.';
    }

    if (!state.titleRegistration || state.titleRegistration.trim() === '') {
      nextErrors.titleRegistration = 'Required.';
    } else if (Number(state.titleRegistration) < 0 || !Number.isFinite(Number(state.titleRegistration))) {
      nextErrors.titleRegistration = 'Cannot be negative.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setFlags(quoteRedFlags(parseNonNegative(state.docFee), parseAddOns(state.addOnsText)));
    onComplete?.();
  }

  function update(field: keyof FeeState, value: string) {
    setState((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-navy-900">Step 8 of 8 — Dealer Quote & Fee Audit</h2>
        <p className="mt-1 text-ink-600">
          Enter the itemized fees from the dealer quote. The auditor flags documentation fees above
          the {formatCurrency(DOC_FEE_THRESHOLD)} reference threshold and known high-margin add-ons.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="docFee" className="block text-sm font-semibold text-navy-900">
            Documentation fee *
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
            <input
              id="docFee"
              type="number"
              min="0"
              step="5"
              value={state.docFee}
              onChange={(e) => update('docFee', e.target.value)}
              className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${errors.docFee ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200'}`}
              placeholder="129"
              aria-invalid={!!errors.docFee}
              aria-describedby={errors.docFee ? 'docFee-error' : undefined}
            />
          </div>
          {errors.docFee && (
            <p id="docFee-error" className="text-xs text-red-600">{errors.docFee}</p>
          )}
          <p className="text-xs text-ink-500">Dealer &quot;doc fee&quot; — above $150 is a red flag.</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="titleRegistration" className="block text-sm font-semibold text-navy-900">
            Title & registration *
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
            <input
              id="titleRegistration"
              type="number"
              min="0"
              step="5"
              value={state.titleRegistration}
              onChange={(e) => update('titleRegistration', e.target.value)}
              className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${errors.titleRegistration ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200'}`}
              placeholder="345"
              aria-invalid={!!errors.titleRegistration}
              aria-describedby={errors.titleRegistration ? 'titleRegistration-error' : undefined}
            />
          </div>
          {errors.titleRegistration && (
            <p id="titleRegistration-error" className="text-xs text-red-600">{errors.titleRegistration}</p>
          )}
          <p className="text-xs text-ink-500">State title, registration, and tag costs.</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="addOnsText" className="block text-sm font-semibold text-navy-900">
          Add-ons (comma-separated)
        </label>
        <textarea
          id="addOnsText"
          rows={2}
          value={state.addOnsText}
          onChange={(e) => update('addOnsText', e.target.value)}
          className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Fabric Protection, Nitrogen Tires, Glass Etching"
        />
        <p className="text-xs text-ink-500">
          List every add-on the dealer included. Paint/fabric protection, nitrogen tires, and glass
          etching are flagged as high-margin.
        </p>
      </div>

      {flags !== null && (
        <div
          className={`rounded-xl border p-6 ${
            flags.length === 0 ? 'border-good-200 bg-good-50' : 'border-red-200 bg-red-50'
          }`}
        >
          {flags.length === 0 ? (
            <p className="font-semibold text-good-900">Clean quote — no red flags detected</p>
          ) : (
            <div>
              <p className="font-semibold text-red-800">
                {flags.length} red flag{flags.length === 1 ? '' : 's'} detected
              </p>
              <ul className="mt-2 space-y-1.5">
                {flags.map((flag, i) => (
                  <li key={i} className="text-sm text-red-800">
                    • {flag.label}
                    {flag.type === 'docFee' && typeof flag.value === 'number'
                      ? ` (${formatCurrency(flag.value)} > ${formatCurrency(flag.threshold ?? DOC_FEE_THRESHOLD)})`
                      : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          Audit quote
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </form>
  );
}
