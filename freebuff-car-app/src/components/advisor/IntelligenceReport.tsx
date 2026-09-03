'use client';

import { useEffect, useState } from 'react';
import { monthlyPayment, totalCost } from '@/utils/financeCalculators';
import { docFeeFlags, addOnFlags } from '@/utils/redFlags';
import type { AdvisorState } from '@/hooks/useAdvisorState';

import { REPORT_STORAGE_KEY } from '@/lib/progress';

type StoredReport = {
  savedAt: string;
};

function loadReport(): StoredReport | null {
  try {
    const raw = window.localStorage.getItem(REPORT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredReport) : null;
  } catch {
    return null;
  }
}

function parseNumber(value: unknown): number {
  const n = Number(value);
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function str(state: Record<string, unknown> | undefined, key: string): string {
  const v = state?.[key];
  return typeof v === 'string' ? v : '';
}

/** Ownership budget monthly total from the saved Step 5 state. */
function ownershipTotal(ownership: Record<string, unknown> | undefined): number | null {
  if (!ownership) return null;
  const keys = ['monthlyLoan', 'insurance', 'fuel', 'maintenance', 'registration', 'parking', 'taxesAndFees', 'other'];
  const values = keys.map((k) => parseNumber(ownership[k]));
  // Treat an all-zero payload as "not really filled in" — show the empty state.
  if (values.every((v) => v === 0)) return null;
  return values.reduce((a, b) => a + b, 0);
}

const NEED_LABELS: Record<string, string> = {
  awd: 'All-wheel drive',
  seating5plus: '5+ seats',
  highFuelEconomy: '30+ MPG combined',
  topSafetyPick: 'IIHS Top Safety Pick+',
  appleCarPlay: 'Apple CarPlay',
  androidAuto: 'Android Auto',
};

interface Props {
  onComplete?: () => void;
  /** The advisor session store — every section renders from what the user actually entered. */
  advisor?: AdvisorState | null;
  /** Clears the advisor session (store + report marker) and returns to Step 1. */
  onReset?: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
      <h4 className="font-semibold text-navy-900">{title}</h4>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Empty({ step }: { step: string }) {
  return <p className="text-sm text-ink-500">Step {step} not completed yet — finish it to see this section filled in.</p>;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const toneClass = tone === 'good' ? 'text-good-700' : tone === 'bad' ? 'text-red-700' : 'text-ink-800';
  return (
    <li className="flex items-start justify-between gap-3 text-sm">
      <span className="text-ink-600">{label}</span>
      <span className={`shrink-0 font-semibold ${toneClass}`}>{value}</span>
    </li>
  );
}

export default function IntelligenceReport({ onComplete, advisor, onReset }: Props = {}) {
  const [consent, setConsent] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  useEffect(() => {
    const existing = loadReport();
    if (existing) {
      setSavedAt(existing.savedAt);
      setGenerated(true);
    }
  }, []);

  // Session-derived values, computed on every render from the store.
  const intake = advisor?.intake as Record<string, unknown> | undefined;
  const finance = advisor?.finance as Record<string, unknown> | undefined;
  const trade = advisor?.trade as Record<string, unknown> | undefined;
  const fees = advisor?.fees as Record<string, unknown> | undefined;
  const ownership = advisor?.ownership as Record<string, unknown> | undefined;
  const vehicles = advisor?.vehicles as { needs?: Record<string, boolean>; comparing?: string[] } | undefined;
  const dealScore = advisor?.dealScore as
    | { input?: Record<string, unknown>; result?: { score: number; breakdown: { label: string; earned: number; maxPoints: number; reason: string }[] } }
    | undefined;

  const monthlyBudget = parseNumber(intake?.monthlyBudget);
  const hasFinance = !!finance && str(finance, 'vehiclePrice').trim() !== '';
  const fPrice = parseNumber(finance?.vehiclePrice);
  const fDown = parseNumber(finance?.downPayment);
  const fApr = parseNumber(finance?.apr);
  const fTerm = parseNumber(finance?.termMonths);
  const fPayment = hasFinance ? monthlyPayment(fPrice - fDown, fApr, fTerm) : 0;
  const fTotal = hasFinance ? totalCost(fPrice - fDown, fApr, fTerm) : 0;

  const hasTrade = !!trade && (str(trade, 'tradeValue').trim() !== '' || str(trade, 'payoff').trim() !== '');
  const tradeValue = parseNumber(trade?.tradeValue);
  const tradePayoff = parseNumber(trade?.payoff);
  const equity = tradeValue - tradePayoff;

  const hasFees = !!fees && str(fees, 'docFee').trim() !== '';
  const docFee = parseNumber(fees?.docFee);
  const titleReg = parseNumber(fees?.titleRegistration);
  const addOnList = str(fees, 'addOnsText').split(',').map((a) => a.trim()).filter(Boolean);
  const feeFlags = hasFees ? [...docFeeFlags(docFee), ...addOnFlags(addOnList)] : [];

  const ownTotal = ownershipTotal(ownership);

  const activeNeeds = vehicles?.needs
    ? Object.entries(vehicles.needs).filter(([, v]) => v).map(([k]) => NEED_LABELS[k] ?? k)
    : [];
  const comparingCount = vehicles?.comparing?.length ?? 0;

  const score = dealScore?.result?.score;
  const hasScore = typeof score === 'number';

  function performReset() {
    try {
      window.localStorage.removeItem(REPORT_STORAGE_KEY);
    } catch {
      // storage unavailable: nothing to remove
    }
    setConfirmingReset(false);
    setGenerated(false);
    setSavedAt(null);
    setConsent(false);
    onReset?.();
  }

  function generate() {
    const report: StoredReport = { savedAt: new Date().toISOString() };
    try {
      window.localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(report));
    } catch {
      // Storage unavailable — the report still renders for printing.
    }
    setSavedAt(report.savedAt);
    setGenerated(true);
    onComplete?.();
  }

  const hasAnyData = Boolean(monthlyBudget || hasFinance || hasTrade || hasFees || ownTotal !== null || activeNeeds.length > 0 || hasScore);

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h2 className="text-xl font-bold text-navy-900">Step 11 of 11 — Intelligence Report</h2>
        <p className="mt-1 text-ink-600">
          Your complete car-buying briefing, assembled from the numbers you entered across the flow —
          ready to print and take with you.
        </p>
      </div>

      {!generated ? (
        <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm print:hidden">
          <p className="text-sm text-ink-700">
            The report summarizes your session: financing math, trade-in position, dealer-quote red
            flags, ownership budget, and your deal score. It is educational guidance based on the
            numbers you entered — not financial advice.
          </p>
          {!hasAnyData && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Tip: you have not saved any step data yet. The report will render, but every section will
              be empty until you complete the earlier steps.
            </p>
          )}
          <div className="mt-4 flex items-start gap-2">
            <input
              id="consent"
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-ink-300 text-navy-900 focus:ring-blue-500"
            />
            <label htmlFor="consent" className="text-sm text-ink-700">
              I understand this report is educational guidance, not financial advice.
            </label>
          </div>
          <button
            type="button"
            disabled={!consent}
            onClick={generate}
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            Generate report
          </button>
        </div>
      ) : (
        <div id="report-print" className="space-y-5">
          <div className="rounded-xl border border-navy-200 bg-navy-50 p-5">
            <h3 className="text-lg font-bold text-navy-900">Car Purchase Intelligence Report</h3>
            {savedAt && (
              <p className="mt-1 text-xs text-ink-600">Saved {new Date(savedAt).toLocaleString()}</p>
            )}
          </div>

          {/* Budget snapshot (Step 1) */}
          <Section title="Your budget">
            {monthlyBudget > 0 ? (
              <ul className="space-y-1.5">
                <Row label="Monthly budget" value={formatCurrency(monthlyBudget)} />
                {parseNumber(intake?.downPayment) > 0 && (
                  <Row label="Down payment" value={formatCurrency(parseNumber(intake?.downPayment))} />
                )}
                {str(intake, 'creditRange') && <Row label="Credit range" value={str(intake, 'creditRange')} />}
              </ul>
            ) : (
              <Empty step="1" />
            )}
          </Section>

          {/* Financing math (Step 3) */}
          <Section title="Financing math">
            {hasFinance ? (
              <ul className="space-y-1.5">
                <Row label="Vehicle price" value={formatCurrency(fPrice)} />
                <Row label="Amount financed" value={formatCurrency(Math.max(0, fPrice - fDown))} />
                <Row label="APR / term" value={`${fApr}% / ${fTerm} mo`} />
                <Row label="Monthly payment" value={formatCurrency(Math.round(fPayment))} tone={monthlyBudget > 0 ? (fPayment <= monthlyBudget ? 'good' : 'bad') : undefined} />
                <Row label="Total cost of loan" value={formatCurrency(Math.round(fTotal))} />
                {monthlyBudget > 0 && (
                  <li className="pt-1 text-xs text-ink-500">
                    {fPayment <= monthlyBudget
                      ? 'Payment fits within your monthly budget.'
                      : 'Payment is OVER your monthly budget — renegotiate or pick a cheaper vehicle.'}
                  </li>
                )}
              </ul>
            ) : (
              <Empty step="3" />
            )}
          </Section>

          {/* Trade-in position (Step 7) */}
          <Section title="Trade-in position">
            {hasTrade ? (
              <ul className="space-y-1.5">
                <Row label="Trade-in value" value={formatCurrency(tradeValue)} />
                <Row label="Loan payoff" value={formatCurrency(tradePayoff)} />
                <Row
                  label="Equity"
                  value={`${equity >= 0 ? '+' : ''}${formatCurrency(equity)}`}
                  tone={equity >= 0 ? 'good' : 'bad'}
                />
                {equity < 0 && (
                  <li className="pt-1 text-xs text-red-600">
                    Negative equity — the payoff exceeds the trade value. Avoid rolling it into the new loan.
                  </li>
                )}
              </ul>
            ) : (
              <Empty step="7" />
            )}
          </Section>

          {/* Dealer-quote audit (Step 8) */}
          <Section title="Dealer-quote audit">
            {hasFees ? (
              <div className="space-y-2">
                <ul className="space-y-1.5">
                  <Row label="Documentation fee" value={formatCurrency(docFee)} tone={docFee > 150 ? 'bad' : 'good'} />
                  <Row label="Title & registration" value={formatCurrency(titleReg)} />
                  {addOnList.length > 0 && <Row label="Add-ons quoted" value={addOnList.join(', ')} />}
                </ul>
                {feeFlags.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
                    {feeFlags.map((flag) => (
                      <li key={flag.label}>{flag.label}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-good-700">No red flags detected in this quote.</p>
                )}
              </div>
            ) : (
              <Empty step="8" />
            )}
          </Section>

          {/* Ownership budget (Step 5) */}
          <Section title="Monthly ownership budget">
            {ownTotal !== null ? (
              <Row label="Estimated total per month" value={formatCurrency(Math.round(ownTotal))} />
            ) : (
              <Empty step="5" />
            )}
          </Section>

          {/* Vehicle needs (Step 2) */}
          <Section title="Non-negotiable needs">
            {activeNeeds.length > 0 ? (
              <div className="space-y-1.5">
                <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
                  {activeNeeds.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
                {comparingCount > 0 && (
                  <p className="text-xs text-ink-500">{comparingCount} vehicle{comparingCount === 1 ? '' : 's'} marked for comparison.</p>
                )}
              </div>
            ) : (
              <Empty step="2" />
            )}
          </Section>

          {/* Deal score (Step 10) */}
          <Section title="Deal score">
            {hasScore ? (
              <div className="space-y-2">
                <p className="text-2xl font-bold text-navy-900">
                  {score}<span className="text-sm font-medium text-ink-500"> / 100</span>
                </p>
                <ul className="space-y-1.5">
                  {dealScore?.result?.breakdown.map((item) => (
                    <li key={item.label} className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-ink-600">{item.label}</span>
                      <span className="shrink-0 font-semibold text-ink-800">
                        {item.earned}/{item.maxPoints}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Empty step="10" />
            )}
          </Section>

          <Section title="Negotiation ground rules">
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
              <li>Negotiate the out-the-door price first — payments last.</li>
              <li>Get every number in writing before discussing financing.</li>
              <li>Decline high-margin add-ons; they are optional, not required.</li>
              <li>Walking away is your strongest move, and it costs nothing.</li>
            </ul>
          </Section>

          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              Print report
            </button>
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              data-testid="start-over"
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 shadow-sm transition-colors hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
            >
              Start Over
            </button>
          </div>

          {confirmingReset && (
            <div
              role="alertdialog"
              aria-modal="false"
              aria-labelledby="reset-confirm-title"
              data-testid="reset-confirm"
              className="rounded-xl border border-red-200 bg-red-50 p-5 print:hidden"
            >
              <h4 id="reset-confirm-title" className="font-semibold text-red-900">
                Start over from Step 1?
              </h4>
              <p className="mt-1 text-sm text-red-800">
                This clears your saved session — every step, your budgets, and this generated
                report. This cannot be undone.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={performReset}
                  data-testid="reset-confirm-yes"
                  className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
                >
                  Yes, clear everything
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  data-testid="reset-confirm-no"
                  className="inline-flex items-center rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 shadow-sm transition-colors hover:bg-ink-50"
                >
                  Keep my session
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
