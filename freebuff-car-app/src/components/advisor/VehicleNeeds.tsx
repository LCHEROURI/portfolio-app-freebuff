'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Vehicle } from '@/data/vehicles';
import { MPG_UNKNOWN } from '@/lib/marketcheck';
import { APR_BY_CREDIT, BUDGET_TERM_MONTHS, estimateMonthlyPayment, minDownPaymentForBudget } from '@/lib/affordability';

/** Persisted spec snapshot for one compared vehicle (Step 2 → report). */
export interface VehicleSpecSnapshot {
  title: string;
  msrp: number;
  /** Combined MPG; null when the feed has no figure — never fabricated. */
  mpg: number | null;
  seating: number;
  drive: string;
  safety: string;
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

/** Shape of the intake payload saved by Step 1 (IntakeForm). */
export interface IntakeSummary {
  monthlyBudget?: string;
  downPayment?: string;
  creditRange?: string;
  zip?: string;
  bodyStyle?: string;
  [key: string]: unknown;
}

interface InventoryResponse {
  source: 'marketcheck' | 'demo';
  vehicles: Vehicle[];
  numFound?: number;
  demoReason?: string;
  /** Echoed price ceiling when a budget filter was applied (marketcheck only). */
  priceMax?: number;
}

type FetchState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | {
      phase: 'ready';
      source: InventoryResponse['source'];
      vehicles: Vehicle[];
      /** Present when the search was budget-capped; drives the empty state. */
      priceMax?: number;
    };

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function mpgLabel(mpg: number): string {
  return mpg === MPG_UNKNOWN ? 'n/a' : `${mpg}`;
}

function vehicleMeetsNeeds(vehicle: Vehicle, needs: Needs): Record<string, boolean> {
  return {
    awd: !needs.awd || vehicle.drive === 'awd',
    seating5plus: !needs.seating5plus || vehicle.seating >= 5,
    // MPG 0 = unknown in this feed → the need counts as unmet, never faked.
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
  /** Step 1 intake; budget/zip/body style funnel into the inventory query. */
  intake?: IntakeSummary | null;
  /** Persist the needs selection + comparison set to the advisor store. */
  onSaveData?: (data: unknown) => void;
}

export default function VehicleNeeds({ onContinue, intake, onSaveData }: Props = {}) {
  const [needs, setNeeds] = useState<Needs>(DEFAULT_NEEDS);
  const [comparing, setComparing] = useState<string[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>({ phase: 'loading' });

  // Deterministic query string from intake + a refresh nonce, so a retry
  // re-runs the effect (React deps) rather than refetching imperatively.
  const query = (() => {
    const p = new URLSearchParams();
    if (intake?.monthlyBudget) p.set('budget', intake.monthlyBudget);
    if (intake?.downPayment) p.set('down', intake.downPayment);
    if (intake?.creditRange) p.set('credit', intake.creditRange);
    if (intake?.zip) p.set('zip', intake.zip);
    if (intake?.bodyStyle) p.set('bodyType', intake.bodyStyle);
    return p.toString();
  })();
  const [nonce, setNonce] = useState(0);

  const loadInventory = useCallback(async () => {
    setFetchState({ phase: 'loading' });
    try {
      // Test hook: injected data bypasses the network entirely.
      const injected = typeof window !== 'undefined'
        ? (window as unknown as Record<string, unknown>).__VEHICLE_DATA__
        : undefined;
      if (Array.isArray(injected) && injected.length > 0) {
        setFetchState({ phase: 'ready', source: 'demo', vehicles: injected as Vehicle[] });
        return;
      }
      const qs = query ? `?${query}` : '';
      const res = await fetch(`/api/inventory${qs}`);
      if (!res.ok) throw new Error(`inventory request failed: ${res.status}`);
      const body = (await res.json()) as InventoryResponse;
      if (!Array.isArray(body.vehicles)) throw new Error('inventory payload malformed');
      setFetchState({
        phase: 'ready',
        source: body.source,
        vehicles: body.vehicles,
        priceMax: body.source === 'marketcheck' ? body.priceMax : undefined,
      });
    } catch (err) {
      console.error('[VehicleNeeds] inventory load failed:', err);
      setFetchState({ phase: 'error' });
    }
  }, [query]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory, nonce]);

  // id -> "make model" snapshot of the loaded vehicles, persisted with the
  // step data so exports can name the compared vehicles in filenames.
  function namesSnapshot(): Record<string, string> {
    if (fetchState.phase !== 'ready') return {};
    return Object.fromEntries(fetchState.vehicles.map((v) => [v.id, `${v.make} ${v.model}`]));
  }

  /**
   * Spec snapshots for the compared vehicles, persisted with the step data
   * so the Intelligence Report (screen + .md/.txt exports) can show a real
   * side-by-side comparison — not just the names in the filename. Takes the
   * comparison list explicitly: callers mid-toggle pass the NEXT list, since
   * state has not committed yet.
   */
  function specsSnapshot(forIds: string[]): Record<string, VehicleSpecSnapshot> {
    if (fetchState.phase !== 'ready') return {};
    const snapshot: Record<string, VehicleSpecSnapshot> = {};
    for (const v of fetchState.vehicles) {
      if (!forIds.includes(v.id)) continue;
      snapshot[v.id] = {
        title: `${v.year} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ''}`,
        msrp: v.msrp,
        mpg: v.fuelEconomyCombined === MPG_UNKNOWN ? null : v.fuelEconomyCombined,
        seating: v.seating,
        drive: v.drive,
        safety: v.safetyRating,
      };
    }
    return snapshot;
  }

  function toggleNeed<K extends keyof Needs>(key: K) {
    setNeeds((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      onSaveData?.({ needs: next, comparing, names: namesSnapshot(), specs: specsSnapshot(comparing) });
      return next;
    });
  }

  function toggleCompare(id: string) {
    setComparing((prev) => {
      const next = prev.includes(id) ? prev.filter((v) => v !== id) : prev.length < 3 ? [...prev, id] : prev;
      onSaveData?.({ needs, comparing: next, names: namesSnapshot(), specs: specsSnapshot(next) });
      return next;
    });
  }

  const activeNeeds = Object.entries(needs).filter(([, v]) => v);
  const anyNeedActive =
    needs.awd || needs.seating5plus || needs.highFuelEconomy || needs.topSafetyPick || needs.appleCarPlay || needs.androidAuto;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-navy-900">Step 2 of 10 — Compare your vehicles</h2>
        <p className="mt-1 text-ink-600">
          Review the vehicles below and check the needs that matter to you. Vehicles that miss a checked need
          are flagged.
        </p>
      </div>

      {/* Live-feed status banner */}
      {fetchState.phase === 'ready' && fetchState.source === 'demo' && (
        <div data-testid="demo-banner" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Demo inventory — live feed not configured. These are sample vehicles; when a MarketCheck key is set,
          real listings replace them automatically.
        </div>
      )}
      {fetchState.phase === 'error' && (
        <div data-testid="error-banner" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold">Could not load inventory.</p>
          <p className="mt-1">The vehicle feed is temporarily unavailable.</p>
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

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
      {fetchState.phase === 'loading' && (
        <div data-testid="loading" className="space-y-4" aria-busy="true" aria-label="Loading vehicles">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
              <div className="h-4 w-2/3 rounded bg-ink-100" />
              <div className="mt-2 h-3 w-1/2 rounded bg-ink-100" />
              <div className="mt-3 h-3 w-1/3 rounded bg-ink-100" />
            </div>
          ))}
        </div>
      )}

      {/* Honest empty state: a valid budget cap can genuinely match nothing.
          This is a real answer, not an error — so it never falls back to demo. */}
      {fetchState.phase === 'ready' && fetchState.vehicles.length === 0 && (
        <div
          data-testid="empty-results"
          className="rounded-xl border border-ink-200 bg-white p-8 text-center shadow-sm"
        >
          <h3 className="text-base font-semibold text-navy-900">No vehicles under your budget yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-600">
            {fetchState.priceMax
              ? <>Your {formatCurrency(fetchState.priceMax)} price ceiling comes from your Step 1 monthly budget. New vehicles rarely start below this — try a higher budget, a larger down payment, or consider used.</>
              : 'The live feed returned no matching vehicles. Try adjusting your filters or search again.'}
          </p>
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="mt-4 rounded-lg bg-navy-900 px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
          >
            Search again
          </button>
        </div>
      )}

      {fetchState.phase === 'ready' && fetchState.vehicles.length > 0 && (() => {
        const term = BUDGET_TERM_MONTHS;
        const apr = APR_BY_CREDIT[(intake?.creditRange as keyof typeof APR_BY_CREDIT) ?? 'good'] ?? APR_BY_CREDIT.good;
        const downRaw = Number.parseFloat(intake?.downPayment ?? '');
        const intakeDown = Number.isFinite(downRaw) && downRaw > 0 ? downRaw : 0;
        const intakeCredit = intake?.creditRange ?? '';
        return (
        <div className="space-y-4">
          {fetchState.vehicles.map((vehicle) => {
            const meets = vehicleMeetsNeeds(vehicle, needs);
            const allMet = allNeedsMet(meets);
            const met = meetsCount(meets);
            const total = Object.keys(needs).length;
            const isComparing = comparing.includes(vehicle.id);
            const estPayment = estimateMonthlyPayment({
              price: vehicle.msrp,
              downPayment: intakeDown,
              creditRange: intakeCredit,
            });
            const budgetNum = Number.parseFloat(intake?.monthlyBudget ?? '');
            const budget = Number.isFinite(budgetNum) && budgetNum > 0 ? budgetNum : null;
            const requiredDown = budget !== null
              ? minDownPaymentForBudget({ price: vehicle.msrp, monthlyBudget: budget, creditRange: intakeCredit })
              : null;
            const fits = budget !== null && estPayment !== null && estPayment <= budget;

            return (
              <div
                key={vehicle.id}
                data-testid="vehicle-card"
                className={`rounded-xl border bg-white p-5 shadow-sm transition-colors ${
                  anyNeedActive
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
                      {formatCurrency(vehicle.msrp)} MSRP · {mpgLabel(vehicle.fuelEconomyCombined)}
                      {vehicle.fuelEconomyCombined === MPG_UNKNOWN ? '' : ' MPG combined'} ·{' '}
                      {vehicle.seating} seats · {vehicle.drive.toUpperCase()} · {vehicle.safetyRating}
                    </p>
                    {intake?.monthlyBudget && (estPayment !== null ? (
                      <p className="mt-1 text-sm font-medium text-navy-900" data-testid="est-payment">
                        <span className={fits ? 'text-good-700' : 'text-amber-700'}>
                          Est. {formatCurrency(estPayment)}/mo
                        </span>
                        <span className="sr-only">{fits ? 'Within your monthly budget.' : 'Above your monthly budget.'}</span>
                        <span className="font-normal text-ink-500">
                          {' '}· {term} mo at {apr}% APR with {formatCurrency(intakeDown)} down
                        </span>
                        {budget !== null && requiredDown !== null && (
                          <span className="mt-0.5 block text-xs font-normal text-amber-700" data-testid="down-hint">
                            About {formatCurrency(requiredDown)} down would bring this within your {formatCurrency(budget)}/mo budget.
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-ink-500" data-testid="est-payment">
                        Est. payment unavailable — {formatCurrency(vehicle.msrp)} MSRP with {formatCurrency(intakeDown)} down leaves nothing to finance.
                      </p>
                    ))}
                    {vehicle.tech.length > 0 && (
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
                    )}
                  </div>
                  <div className="ml-4 shrink-0">
                    {anyNeedActive ? (
                      <div className="flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-600">
                        {met}/{total} needs met
                      </div>
                    ) : (
                      <span className="text-xs text-ink-400">No needs selected</span>
                    )}
                  </div>
                </div>

                {/* Needs status */}
                {anyNeedActive && (
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
                )}

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
          {intake?.monthlyBudget && (
            <p className="text-xs text-ink-400">
              Payment estimates use your Step 1 down payment and credit range over a {term}-month loan, plus an allowance for sales tax and fees. Step 3 computes exact figures from your real deal.
            </p>
          )}
        </div>
        );
      })()}

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
    </div>
  );
}
