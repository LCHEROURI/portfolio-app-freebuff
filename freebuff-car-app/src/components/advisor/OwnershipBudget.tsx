'use client';

import { useState, type FormEvent } from 'react';
interface OwnershipState {
  monthlyLoan: string;
  insurance: string;
  fuel: string;
  maintenance: string;
  registration: string;
  parking: string;
  taxesAndFees: string;
  other: string;
}

const DEFAULT_STATE: OwnershipState = {
  monthlyLoan: '500',
  insurance: '120',
  fuel: '150',
  maintenance: '75',
  registration: '30',
  parking: '0',
  taxesAndFees: '40',
  other: '0',
};

function parsePositive(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
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

export default function OwnershipBudget({ onComplete, onSaveData }: Props = {}) {
  const [state, setState] = useState<OwnershipState>(DEFAULT_STATE);
  const [errors, setErrors] = useState<Partial<OwnershipState>>({});
  const [submitted, setSubmitted] = useState(false);

  const monthlyLoan = parsePositive(state.monthlyLoan);
  const insurance = parsePositive(state.insurance);
  const fuel = parsePositive(state.fuel);
  const maintenance = parsePositive(state.maintenance);
  const registration = parsePositive(state.registration);
  const parking = parsePositive(state.parking);
  const taxesAndFees = parsePositive(state.taxesAndFees);
  const other = parsePositive(state.other);

  const monthlyOwnership = monthlyLoan + insurance + fuel + maintenance + registration + parking + taxesAndFees + other;

  function validate(): boolean {
    const nextErrors: Partial<OwnershipState> = {};

    const rawMonthlyLoan = state.monthlyLoan;
    if (!rawMonthlyLoan || rawMonthlyLoan.trim() === '') {
      nextErrors.monthlyLoan = 'Required.';
    } else if (parsePositive(rawMonthlyLoan) <= 0) {
      nextErrors.monthlyLoan = 'Must be greater than zero.';
    }

    const rawInsurance = state.insurance;
    if (!rawInsurance || rawInsurance.trim() === '') {
      nextErrors.insurance = 'Required.';
    } else if (parsePositive(rawInsurance) <= 0) {
      nextErrors.insurance = 'Must be greater than zero.';
    }

    const rawFuel = state.fuel;
    if (!rawFuel || rawFuel.trim() === '') {
      nextErrors.fuel = 'Required.';
    } else if (parsePositive(rawFuel) <= 0) {
      nextErrors.fuel = 'Must be greater than zero.';
    }

    const rawMaintenance = state.maintenance;
    if (!rawMaintenance || rawMaintenance.trim() === '') {
      nextErrors.maintenance = 'Required.';
    } else if (parsePositive(rawMaintenance) <= 0) {
      nextErrors.maintenance = 'Must be greater than zero.';
    }

    const rawRegistration = state.registration;
    if (!rawRegistration || rawRegistration.trim() === '') {
      nextErrors.registration = 'Required.';
    } else if (parsePositive(rawRegistration) < 0) {
      nextErrors.registration = 'Cannot be negative.';
    }

    if (parsePositive(state.parking) < 0) {
      nextErrors.parking = 'Cannot be negative.';
    }

    if (parsePositive(state.taxesAndFees) < 0) {
      nextErrors.taxesAndFees = 'Cannot be negative.';
    }

    if (parsePositive(state.other) < 0) {
      nextErrors.other = 'Cannot be negative.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = validate();
    if (!ok) {
      setErrors((prev) => ({ ...prev }));
    } else {
      setSubmitted(true);
      onSaveData?.(state);
      onComplete?.();
    }
  }

  function update(field: keyof OwnershipState, value: string) {
    setState((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  const otherCosts = monthlyOwnership - monthlyLoan;
  const affordabilityGap = otherCosts - monthlyLoan;
  const isAffordable = affordabilityGap >= 0;

  if (submitted) {
    return (
      <div className="rounded-xl border border-good-200 bg-good-50 p-6">
        <div className="flex items-start gap-3">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-good-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="font-semibold text-good-900">Your monthly ownership cost is ready</p>
            <p className="mt-1 text-sm text-good-800">
              {isAffordable
                ? `You have ${formatCurrencyCents(affordabilityGap)}/month left after all ownership costs.`
                : `Your monthly payment is ${formatCurrencyCents(Math.abs(affordabilityGap))} more than your total ownership budget.`}
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-good-800">Monthly payment (loan)</p>
                <p className="text-lg font-semibold text-good-900">{formatCurrencyCents(monthlyLoan)}</p>
              </div>
              <div>
                <p className="text-xs text-good-800">Total monthly ownership</p>
                <p className="text-lg font-semibold text-good-900">{formatCurrencyCents(monthlyOwnership)}</p>
              </div>
              <div>
                <p className="text-xs text-good-800">Affordability gap</p>
                <p className={`text-lg font-semibold ${isAffordable ? 'text-good-900' : 'text-red-700'}`}>
                  {isAffordable ? `+$` : '-$'}{formatCurrencyCents(Math.abs(affordabilityGap))}
                </p>
              </div>
              <div>
                <p className="text-xs text-good-800">Status</p>
                <p className={`text-lg font-semibold ${isAffordable ? 'text-good-900' : 'text-red-700'}`}>
                  {isAffordable ? 'Payment affordable' : 'Payment dominates budget'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const lineItems: { field: keyof OwnershipState; label: string; placeholder: string; help: string; min?: number; max?: number; step?: number }[] = [
    { field: 'monthlyLoan', label: 'Monthly payment (loan)', placeholder: '500', step: 10, help: 'From the financing calculator.' },
    { field: 'insurance', label: 'Insurance (est.)', placeholder: '120', step: 5, help: 'Your actual quote may differ.' },
    { field: 'fuel', label: 'Fuel / charging (est.)', placeholder: '150', step: 5, help: 'Based on your driving and fuel type.' },
    { field: 'maintenance', label: 'Scheduled maintenance (est.)', placeholder: '75', step: 5, help: 'Oil, tires, brakes, and routine service.' },
    { field: 'registration', label: 'Registration & tags (est.)', placeholder: '30', step: 5, help: 'Varies by state and vehicle value.' },
    { field: 'parking', label: 'Parking & tolls (est.)', placeholder: '0', step: 5, help: 'Include garage, lot, or toll costs.' },
    { field: 'taxesAndFees', label: 'Taxes & fees (est.)', placeholder: '40', step: 5, help: 'Sales tax, doc fees, and ongoing charges.' },
    { field: 'other', label: 'Other ownership costs (est.)', placeholder: '0', step: 5, help: 'Anything else you expect to pay monthly.' },
  ];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-navy-900">Step 5 of 10 — Cost of Ownership & Ownership Budget</h2>
        <p className="mt-1 text-ink-600">
          Build a realistic monthly ownership budget. Enter your estimated costs for each category — the calculator
          adds them up and compares the total against your monthly payment.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {lineItems.map(({ field, label, placeholder, help, min = 0, step = 5 }) => (
          <div key={field} className="space-y-1.5">
            <label htmlFor={field} className="block text-sm font-semibold text-navy-900">
              {label}
              {field === 'monthlyLoan' ? '*' : field === 'insurance' || field === 'fuel' || field === 'maintenance' ? '*' : ''}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
              <input
                id={field}
                type="number"
                min={min}
                step={step}
                value={state[field]}
                onChange={(e) => update(field, e.target.value)}
                className={`block w-full rounded-lg border bg-white pl-7 pr-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${errors[field] ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-ink-200'}`}
                placeholder={placeholder}
                aria-invalid={!!errors[field]}
                aria-describedby={errors[field] ? `${field}-error` : undefined}
              />
            </div>
            {errors[field] && (
              <p id={`${field}-error`} className="text-xs text-red-600">{errors[field]}</p>
            )}
            <p className="text-xs text-ink-500">{help}</p>
          </div>
        ))}
      </div>

      {/* Live preview */}
      {monthlyLoan > 0 && (
        <div className="rounded-xl border border-ink-200 bg-ink-50 p-5">
          <p className="text-sm font-semibold text-navy-900">Live preview</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-ink-500">Monthly payment</p>
              <p className="text-base font-semibold text-ink-900">{formatCurrencyCents(monthlyLoan)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Insurance</p>
              <p className="text-base font-semibold text-ink-900">{formatCurrencyCents(insurance)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Fuel / charging</p>
              <p className="text-base font-semibold text-ink-900">{formatCurrencyCents(fuel)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Maintenance</p>
              <p className="text-base font-semibold text-ink-900">{formatCurrencyCents(maintenance)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Registration</p>
              <p className="text-base font-semibold text-ink-900">{formatCurrencyCents(registration)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Parking & tolls</p>
              <p className="text-base font-semibold text-ink-900">{formatCurrencyCents(parking)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Taxes & fees</p>
              <p className="text-base font-semibold text-ink-900">{formatCurrencyCents(taxesAndFees)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Other</p>
              <p className="text-base font-semibold text-ink-900">{formatCurrencyCents(other)}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-ink-100 px-4 py-3 text-sm font-medium text-ink-900">
            <span>Total monthly ownership:</span>
            <span className="font-semibold">{formatCurrencyCents(monthlyOwnership)}</span>
          </div>
          {monthlyLoan > 0 && (
            <p className="mt-2 text-xs text-ink-500">
              {isAffordable
                ? `Your monthly payment is ${formatCurrencyCents(affordabilityGap)} less than your other ownership costs.`
                : `Your monthly payment exceeds your other ownership costs by ${formatCurrencyCents(Math.abs(affordabilityGap))}.`}
            </p>
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
