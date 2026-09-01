'use client';

import { useState } from 'react';
import type { Vehicle } from '@/data/vehicles';
import { SAMPLE_VEHICLES } from '@/data/vehicles';

interface Needs {
  awd: boolean;
  seating5plus: boolean;
  highFuelEconomy: boolean;
  topSafetyPick: boolean;
  appleCarPlay: boolean;
  androidAuto: boolean;
}

interface Props {
  onContinue?: () => void;
}

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

function vehicleTier(vehicle: Vehicle, meets: Record<string, boolean>, needs: Needs): 1 | 2 | 3 {
  const activeKeys = Object.keys(needs).filter((k) => needs[k as keyof Needs]);
  if (activeKeys.length === 0) return 1;
  const met = activeKeys.filter((k) => meets[k as keyof Needs]).length;
  if (met === activeKeys.length) return 1;
  const missed = activeKeys.length - met;
  if (missed >= 2) return 3;
  return 2;
}

function buildStrengthsConcerns(
  vehicle: Vehicle
): { strengths: string[]; concerns: string[] } {
  const strengths: string[] = [];
  const concerns: string[] = [];

  if (vehicle.fuelEconomyCombined >= 30) {
    strengths.push(vehicle.fuelEconomyCombined + ' MPG combined');
  } else {
    concerns.push('only ' + vehicle.fuelEconomyCombined + ' MPG combined');
  }

  if (vehicle.drive === 'awd') {
    strengths.push('all-wheel drive');
  } else {
    concerns.push('front-wheel drive only');
  }

  if (vehicle.safetyRating.includes('Top Safety Pick')) {
    strengths.push(vehicle.safetyRating);
  } else {
    concerns.push('no IIHS Top Safety Pick+');
  }

  if (vehicle.seating >= 5) {
    strengths.push(vehicle.seating + ' seats');
  } else {
    concerns.push('only ' + vehicle.seating + ' seats');
  }

  if (vehicle.tech.includes('Apple CarPlay')) {
    strengths.push('Apple CarPlay');
  } else {
    concerns.push('no Apple CarPlay');
  }

  if (vehicle.tech.includes('Android Auto')) {
    strengths.push('Android Auto');
  } else {
    concerns.push('no Android Auto');
  }

  if (vehicle.msrp < 30000) {
    strengths.push(formatCurrency(vehicle.msrp) + ' starting MSRP');
  } else if (vehicle.msrp > 35000) {
    concerns.push(formatCurrency(vehicle.msrp) + ' starting MSRP');
  }

  return { strengths, concerns };
}

function tierLabel(tier: 1 | 2 | 3): string {
  if (tier === 1) return 'Best matches — meets your non-negotiables';
  if (tier === 2) return 'Good options — meets most of your needs';
  return 'Compromises — misses multiple needs you flagged';
}

function tierDescription(tier: 1 | 2 | 3): string {
  if (tier === 1) return 'These vehicles check every box you marked. Start negotiations here.';
  if (tier === 2) return 'These come close. If one matters to you, it may be worth a serious look.';
  return 'These require tradeoffs. Consider whether the missing items are truly non-negotiable.';
}

export default function ShoppingStrategy({ onContinue }: Props = {}) {
  const [needs, setNeeds] = useState<Needs>({
    awd: false,
    seating5plus: false,
    highFuelEconomy: false,
    topSafetyPick: false,
    appleCarPlay: false,
    androidAuto: false,
  });

  const windowData = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>).__VEHICLE_DATA__ : undefined;
  const vehicleData = windowData as Vehicle[] | undefined;
  const vehicles: Vehicle[] = vehicleData && vehicleData.length > 0 ? vehicleData : SAMPLE_VEHICLES;

  function toggleNeed<K extends keyof Needs>(key: K) {
    setNeeds((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const activeNeeds = Object.values(needs).filter(Boolean).length;

  const tieredVehicles = vehicles.map((vehicle) => {
    const meets = vehicleMeetsNeeds(vehicle, needs);
    const tier = vehicleTier(vehicle, meets, needs);
    const { strengths, concerns } = buildStrengthsConcerns(vehicle);
    return { vehicle, meets, tier, strengths, concerns };
  });

  const tier1 = tieredVehicles.filter((v) => v.tier === 1);
  const tier2 = tieredVehicles.filter((v) => v.tier === 2);
  const tier3 = tieredVehicles.filter((v) => v.tier === 3);

  function recommendation(): string {
    if (vehicles.length === 0) {
      return 'No vehicles loaded. Check that vehicle data is published.';
    }

    if (activeNeeds === 0) {
      return 'No non-negotiable needs selected yet. Check the boxes above to filter vehicles by what matters most to you.';
    }

    if (tier1.length > 0) {
      const names = tier1.map((v) => v.vehicle.year + ' ' + v.vehicle.make + ' ' + v.vehicle.model).join(', ');
      return 'Focus on these first — they meet all ' + activeNeeds + ' need' + (activeNeeds === 1 ? '' : 's') + ' you flagged: ' + names + '. Compare their out-the-door prices and watch for dealer add-ons that inflate the real cost.';
    }

    if (tier2.length > 0) {
      const names = tier2.map((v) => v.vehicle.year + ' ' + v.vehicle.make + ' ' + v.vehicle.model).join(', ');
      return 'These come close but miss at least one need: ' + names + '. Decide whether the missing item is worth compromising on, or whether to keep looking.';
    }

    const names = tier3.map((v) => v.vehicle.year + ' ' + v.vehicle.make + ' ' + v.vehicle.model).join(', ');
    return 'These miss multiple needs you flagged: ' + names + '. Unless the price is exceptional, consider widening your search or revisiting which needs are truly non-negotiable.';
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-navy-900">Step 6 of 10 — Auto Shopping Strategy &amp; Recommendations</h2>
        <p className="mt-1 text-ink-600">
          Based on the needs you flagged, vehicles are grouped into three tiers. Each tier shows strengths,
          concerns, and a plain-language next step. Adjust the needs checkboxes to refine the strategy.
        </p>
      </div>

      {activeNeeds > 0 && (
        <div className="rounded-xl border border-navy-200 bg-navy-50 p-4">
          <p className="text-sm font-medium text-navy-900">
            {activeNeeds} non-negotiable need{activeNeeds === 1 ? '' : 's'} selected — filtering {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'}
          </p>
        </div>
      )}

      {tier1.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center rounded-full bg-good-600 px-2.5 py-0.5 text-xs font-semibold text-white">
              Tier 1
            </span>
            <h3 className="text-base font-semibold text-navy-900">{tierLabel(1)}</h3>
          </div>
          <p className="text-sm text-ink-600">{tierDescription(1)}</p>
          <div className="space-y-4">
            {tier1.map(({ vehicle, strengths, concerns }) => (
              <div key={vehicle.id} className="rounded-xl border border-good-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-base font-semibold text-navy-900">
                      {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim}
                    </h4>
                    <p className="mt-1 text-sm text-ink-600">
                      {formatCurrency(vehicle.msrp)} MSRP · {vehicle.fuelEconomyCombined} MPG combined ·{' '}
                      {vehicle.seating} seats · {vehicle.drive.toUpperCase()} · {vehicle.safetyRating}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {vehicle.tech.map((t) => (
                        <span key={t} className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs text-ink-600">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-good-800">Strengths</p>
                    <ul className="mt-1 space-y-1">
                      {strengths.map((s) => (
                        <li key={s} className="text-sm text-ink-700">
                          <svg className="mr-1.5 h-3.5 w-3.5 shrink-0 text-good-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-red-700">Concerns</p>
                    <ul className="mt-1 space-y-1">
                      {concerns.map((c) => (
                        <li key={c} className="text-sm text-ink-600">
                          <svg className="mr-1.5 h-3.5 w-3.5 shrink-0 text-ink-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tier2.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-semibold text-white">
              Tier 2
            </span>
            <h3 className="text-base font-semibold text-navy-900">{tierLabel(2)}</h3>
          </div>
          <p className="text-sm text-ink-600">{tierDescription(2)}</p>
          <div className="space-y-4">
            {tier2.map(({ vehicle, strengths, concerns }) => (
              <div key={vehicle.id} className="rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-base font-semibold text-navy-900">
                      {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim}
                    </h4>
                    <p className="mt-1 text-sm text-ink-600">
                      {formatCurrency(vehicle.msrp)} MSRP · {vehicle.fuelEconomyCombined} MPG combined ·{' '}
                      {vehicle.seating} seats · {vehicle.drive.toUpperCase()} · {vehicle.safetyRating}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-blue-800">Strengths</p>
                    <ul className="mt-1 space-y-1">
                      {strengths.map((s) => (
                        <li key={s} className="text-sm text-ink-700">
                          <svg className="mr-1.5 h-3.5 w-3.5 shrink-0 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-red-700">Concerns</p>
                    <ul className="mt-1 space-y-1">
                      {concerns.map((c) => (
                        <li key={c} className="text-sm text-ink-600">
                          <svg className="mr-1.5 h-3.5 w-3.5 shrink-0 text-ink-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tier3.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-semibold text-white">
              Tier 3
            </span>
            <h3 className="text-base font-semibold text-navy-900">{tierLabel(3)}</h3>
          </div>
          <p className="text-sm text-ink-600">{tierDescription(3)}</p>
          <div className="space-y-4">
            {tier3.map(({ vehicle, strengths, concerns }) => (
              <div key={vehicle.id} className="rounded-xl border border-amber-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-base font-semibold text-navy-900">
                      {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim}
                    </h4>
                    <p className="mt-1 text-sm text-ink-600">
                      {formatCurrency(vehicle.msrp)} MSRP · {vehicle.fuelEconomyCombined} MPG combined ·{' '}
                      {vehicle.seating} seats · {vehicle.drive.toUpperCase()} · {vehicle.safetyRating}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-amber-800">Strengths</p>
                    <ul className="mt-1 space-y-1">
                      {strengths.map((s) => (
                        <li key={s} className="text-sm text-ink-700">
                          <svg className="mr-1.5 h-3.5 w-3.5 shrink-0 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-red-700">Concerns</p>
                    <ul className="mt-1 space-y-1">
                      {concerns.map((c) => (
                        <li key={c} className="text-sm text-ink-600">
                          <svg className="mr-1.5 h-3.5 w-3.5 shrink-0 text-ink-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {vehicles.length === 0 && (
        <div className="rounded-xl border border-ink-200 bg-white p-6 text-center">
          <p className="text-sm text-ink-600">No vehicles loaded. Check that vehicle data is published.</p>
        </div>
      )}

      <div className="rounded-xl border border-navy-200 bg-navy-50 p-5">
        <h3 className="font-semibold text-navy-900">Your next step</h3>
        <p className="mt-1 text-sm text-navy-700">{recommendation()}</p>
      </div>

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
              className={'flex cursor-pointer items-center gap-3 rounded-lg border bg-white px-4 py-3 text-sm shadow-sm transition-colors ' + (needs[key] ? 'border-blue-500 bg-blue-50' : 'border-ink-200 hover:border-ink-300')}
            >
              <input
                type="checkbox"
                checked={needs[key]}
                onChange={() => toggleNeed(key)}
                className="h-4 w-4 rounded border-ink-300 text-blue-600 focus:ring-blue-500"
              />
              <span className={needs[key] ? 'font-semibold text-navy-900' : 'text-ink-700'}>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {onContinue && vehicles.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800"
          >
            Continue to budget breakdown
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
