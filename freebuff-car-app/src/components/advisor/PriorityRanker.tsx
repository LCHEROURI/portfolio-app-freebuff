'use client';

import React from 'react';
import { useState, type FormEvent } from 'react';

export type PriorityKey =
  | 'monthlyPayment'
  | 'totalCost'
  | 'fuelEconomy'
  | 'safety'
  | 'technology'
  | 'resaleValue'
  | 'comfort'
  | 'warranty';

export interface PriorityRankerState {
  priorities: Record<PriorityKey, number>;
}

const PRIORITY_LABELS: Record<PriorityKey, { label: string; description: string }> = {
  monthlyPayment: {
    label: 'Monthly payment',
    description: 'Lower payment is more important.',
  },
  totalCost: {
    label: 'Total cost',
    description: 'Lower overall cost is more important.',
  },
  fuelEconomy: {
    label: 'Fuel economy',
    description: 'Higher MPG / lower fuel cost matters more.',
  },
  safety: {
    label: 'Safety',
    description: 'Safety ratings and features matter more.',
  },
  technology: {
    label: 'Technology',
    description: 'Infotainment, driver aids, connectivity.',
  },
  resaleValue: {
    label: 'Resale value',
    description: 'How well the car holds its value.',
  },
  comfort: {
    label: 'Comfort',
    description: 'Seat comfort, ride quality, cabin quiet.',
  },
  warranty: {
    label: 'Warranty',
    description: 'Coverage length and comprehensiveness.',
  },
};

const DEFAULT_PRIORITIES: Record<PriorityKey, number> = {
  monthlyPayment: 3,
  totalCost: 3,
  fuelEconomy: 2,
  safety: 4,
  technology: 2,
  resaleValue: 2,
  comfort: 2,
  warranty: 2,
};

export function getTopPriorities(priorities: Record<PriorityKey, number>, count = 3): PriorityKey[] {
  return Object.entries(priorities)
    .sort(([, a], [, b]) => b - a)
    .slice(0, count)
    .map(([key]) => key as PriorityKey);
}

export function prioritiesMetCount(
  priorities: Record<PriorityKey, number>,
  vehiclePriorities: Partial<Record<PriorityKey, boolean>>,
): number {
  let met = 0;
  for (const key of Object.keys(priorities) as PriorityKey[]) {
    if (vehiclePriorities[key] !== undefined) {
      if (vehiclePriorities[key]) met += 1;
    }
  }
  return met;
}

interface Props {
  onPrioritiesChange?: (priorities: Record<PriorityKey, number>) => void;
}

export default function PriorityRanker({ onPrioritiesChange }: Props = {}) {
  const [priorities, setPriorities] = useState<Record<PriorityKey, number>>(DEFAULT_PRIORITIES);
  const [submitted, setSubmitted] = useState(false);

  function handleSliderChange(key: PriorityKey, value: number) {
    setPriorities((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onPrioritiesChange?.(priorities);
    setSubmitted(true);
  }

  const top3 = getTopPriorities(priorities, 3);

  if (submitted) {
    return (
      <div className="rounded-xl border border-good-200 bg-good-50 p-6">
        <div className="flex items-start gap-3">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-good-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="font-semibold text-good-900">Your priorities are ranked</p>
            <p className="mt-1 text-sm text-good-800">
              Top priorities: {top3.map((k) => PRIORITY_LABELS[k].label).join(', ')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Drag each slider to show how important it is to you — higher means more important.
        </p>

        {Object.entries(PRIORITY_LABELS).map(([key, info]) => {
          const value = priorities[key as PriorityKey];
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div>
                  <label htmlFor={`priority-${key}`} className="text-sm font-semibold text-navy-900">
                    {info.label}
                  </label>
                  <p className="text-xs text-ink-500">{info.description}</p>
                </div>
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                  {value}/5
                </span>
              </div>
              <input
                id={`priority-${key}`}
                type="range"
                min="1"
                max="5"
                value={value}
                onChange={(e) => handleSliderChange(key as PriorityKey, Number(e.target.value))}
                className="block w-full cursor-pointer accent-blue-600 h-2"
              />
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          Save priorities
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </form>
  );
}
