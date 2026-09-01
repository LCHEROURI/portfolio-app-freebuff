'use client';

import { useState } from 'react';

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  trim: string;
  msrp: number;
  fuelEconomyCombined: number;
  seating: number;
  drive: string;
  safetyRating: string;
  tech: string[];
}

interface Needs {
  awd: boolean;
  seating5plus: boolean;
  highFuelEconomy: boolean;
  topSafetyPick: boolean;
  appleCarPlay: boolean;
  androidAuto: boolean;
}

const DEFAULT_NEEDS: Needs = {
  awd: false,
  seating5plus: false,
  highFuelEconomy: false,
  topSafetyPick: false,
  appleCarPlay: false,
  androidAuto: false,
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function vehicleMeetsNeeds(vehicle: Vehicle, needs: Needs): Record<string, boolean> {
  return {
    awd: !needs.awd || vehicle.drive === 'awd',
    seating5plus: !needs.seating5plus || vehicle.seating >= 5,
    highFuelEconomy: !needs.highFuelEconomy || vehicle.fuelEconomyCombined >= 30,
    topSafetyPick: !needs.topSafetyPick || vehicle.safetyRating.includes('Top Safety Pick'),
    appleCarPlay: !needs.appleCarPlay || vehicle.tech.includes('Apple CarPlay'),
    androidAuto: !needs.androidAuto || vehicle.tech.includes('Android Auto'),
  };
}

function allNeedsMet(meets: Record<string, boolean>): boolean {
  return Object.values(meets).every(Boolean);
}

function meetsCount(meets: Record<string, boolean>): number {
  return Object.values(meets).filter(Boolean).length;
}

interface Props {
  onContinue?: () => void;
}

export default function VehicleNeeds({ onContinue }: Props = {}) {
  const [needs, setNeeds] = useState<Needs>(DEFAULT_NEEDS);
  const [comparing, setComparing] = useState<string[]>([]);

  const vehicleData = (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__VEHICLE_DATA__)
    ? (window as unknown as Record<string, unknown>).__VEHICLE_DATA__
    : [];

  const vehicles: Vehicle[] = (vehicleData as Vehicle[]) || [];

  function toggleNeed<K extends keyof Needs>(key: K) {
    setNeeds((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleCompare(id: string) {
    setComparing((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : prev.length < 3 ? [...prev, id] : prev
    );
  }

  const activeNeeds = Object.entries(needs).filter(([, v]) => v);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-navy-900">Step 2 of 10 — Compare your vehicles</h2>
        <p className="mt-1 text-ink-600">
          Review the vehicles below and check the needs that matter to you. Vehicles that miss a checked need
          are flagged.
        </p>
      </div>

      {/* Needs checklist */}
      <fieldset className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
        <legend className="mb-4 text-sm font-semibold text-navy-900">
          Non-negotiable needs (check all that apply)
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            { key: 'awd' as const, label: 'All-wheel drive (AWD)' },
            { key: 'seating5plus' as const, label: '5+ seats' },
            { key: 'highFuelEconomy' as const, label: '30+ MPG combined' },
            { key: 'topSafetyPick' as const, label: 'IIHS Top Safety Pick+' },
            { key: 'appleCarPlay' as const, label: 'Apple CarPlay' },
            { key: 'androidAuto' as const, label: 'Android Auto' },
          ] as const).map(({ key, label }) => (
            <label
              key={key}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border bg-white px-4 py-3 text-sm shadow-sm transition-colors ${
                needs[key] ? 'border-blue-500 bg-blue-50' : 'border-ink-200 hover:border-ink-300'
              }`}
            >
              <input
                type="checkbox"
                checked={needs[key]}
                onChange={() => toggleNeed(key)}
                className="h-4 w-4 rounded border-ink-300 text-blue-600 focus:ring-blue-500"
              />
              <span className={needs[key] ? 'font-semibold text-navy-900' : 'text-ink-700'}>
                {label}
              </span>
            </label>
          ))}
        </div>
        {activeNeeds.length > 0 && (
          <p className="mt-3 text-xs text-ink-500">
            {activeNeeds.length} need{activeNeeds.length === 1 ? '' : 's'} selected. Vehicles missing any checked
            need are marked.
          </p>
        )}
      </fieldset>

      {/* Vehicle cards */}
      <div className="space-y-4">
        {vehicles.map((vehicle) => {
          const meets = vehicleMeetsNeeds(vehicle, needs);
          const allMet = allNeedsMet(meets);
          const met = meetsCount(meets);
          const total = Object.keys(needs).length;
          const isComparing = comparing.includes(vehicle.id);

          return (
            <div
              key={vehicle.id}
              className={`rounded-xl border bg-white p-5 shadow-sm transition-colors ${
                needs.awd || needs.seating5plus || needs.highFuelEconomy || needs.topSafetyPick || needs.appleCarPlay || needs.androidAuto
                  ? allMet
                    ? 'border-good-200'
                    : 'border-red-200'
                  : 'border-ink-200'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-navy-900">
                    {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim}
                  </h3>
                  <p className="mt-1 text-sm text-ink-600">
                    {formatCurrency(vehicle.msrp)} MSRP · {vehicle.fuelEconomyCombined} MPG combined ·{' '}
                    {vehicle.seating} seats · {vehicle.drive.toUpperCase()} · {vehicle.safetyRating}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {vehicle.tech.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs text-ink-600"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="ml-4 shrink-0">
                  {needs.awd || needs.seating5plus || needs.highFuelEconomy || needs.topSafetyPick || needs.appleCarPlay || needs.androidAuto ? (
                    <div className="flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-600">
                      {met}/{total} needs met
                    </div>
                  ) : (
                    <span className="text-xs text-ink-400">No needs selected</span>
                  )}
                </div>
              </div>

              {/* Needs status */}
              {needs.awd || needs.seating5plus || needs.highFuelEconomy || needs.topSafetyPick || needs.appleCarPlay || needs.androidAuto ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(meets).map(([key, met]) => {
                    const label = ({
                      awd: 'AWD',
                      seating5plus: '5+ seats',
                      highFuelEconomy: '30+ MPG',
                      topSafetyPick: 'Top Safety Pick+',
                      appleCarPlay: 'CarPlay',
                      androidAuto: 'Android Auto',
                    }[key] as string);
                    return (
                      <span
                        key={key}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          met
                            ? 'bg-good-100 text-good-800'
                            : 'bg-red-100 text-red-700 line-through'
                        }`}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              ) : null}

              {/* Compare checkbox */}
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`compare-${vehicle.id}`}
                  checked={isComparing}
                  onChange={() => toggleCompare(vehicle.id)}
                  className="h-4 w-4 rounded border-ink-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor={`compare-${vehicle.id}`} className="text-sm text-ink-700">
                  Include in comparison
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {/* Comparison summary */}
      {comparing.length > 0 && (
        <div className="rounded-xl border border-navy-200 bg-navy-50 p-5">
          <h3 className="font-semibold text-navy-900">
            Comparing {comparing.length} vehicle{comparing.length === 1 ? '' : 's'}
          </h3>
          <p className="mt-1 text-sm text-navy-700">
            {comparing.length === 1
              ? 'Add more vehicles to compare side by side.'
              : `You can compare up to 3 vehicles. When ready, continue to the financing calculator.`}
          </p>
        </div>
      )}

      {onContinue && comparing.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800"
          >
            Continue to financing
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      )}

      {vehicles.length === 0 && (
        <div className="rounded-xl border border-ink-200 bg-white p-6 text-center">
          <p className="text-sm text-ink-600">No vehicles loaded. Check that vehicle data is published.</p>
        </div>
      )}
    </div>
  );
}
