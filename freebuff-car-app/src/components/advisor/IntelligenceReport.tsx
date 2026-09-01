'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'freebuff-car-advisor-report-v1';

type StoredReport = {
  savedAt: string;
};

function loadReport(): StoredReport | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredReport) : null;
  } catch {
    return null;
  }
}

const SCORE_COMPONENTS = [
  { label: 'Financing affordability', weight: 25, check: 'Monthly payment fits your budget.' },
  { label: 'No unnecessary add-ons', weight: 20, check: 'Dealer quote is free of high-margin add-ons.' },
  { label: 'Reasonable doc fee', weight: 20, check: 'Documentation fee is at or below $150.' },
  { label: 'Priorities matched', weight: 20, check: 'The vehicle meets your non-negotiable needs.' },
  { label: 'Trade equity', weight: 15, check: 'Trade-in has positive equity — no rollover.' },
];

interface Props {
  onComplete?: () => void;
}

export default function IntelligenceReport({ onComplete }: Props = {}) {
  const [consent, setConsent] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    const existing = loadReport();
    if (existing) {
      setSavedAt(existing.savedAt);
      setGenerated(true);
    }
  }, []);

  function generate() {
    const report: StoredReport = { savedAt: new Date().toISOString() };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(report));
    } catch {
      // Storage unavailable — the report still renders for printing.
    }
    setSavedAt(report.savedAt);
    setGenerated(true);
    onComplete?.();
  }

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h2 className="text-xl font-bold text-navy-900">Step 11 of 11 — Intelligence Report</h2>
        <p className="mt-1 text-ink-600">
          Your complete car-buying briefing: the score components, what to verify at the dealership,
          and your negotiation ground rules — ready to print and take with you.
        </p>
      </div>

      {!generated ? (
        <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm print:hidden">
          <p className="text-sm text-ink-700">
            The report summarizes your session: financing math, trade-in position, dealer-quote red
            flags, priority matches, and your D.R.I.V.E. negotiation script. It is educational
            guidance based on the numbers you entered — not financial advice.
          </p>
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

          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
            <h4 className="font-semibold text-navy-900">Deal score components</h4>
            <ul className="mt-3 space-y-2">
              {SCORE_COMPONENTS.map((c) => (
                <li key={c.label} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-ink-800">
                    <span className="font-medium text-navy-900">{c.label}</span> — {c.check}
                  </span>
                  <span className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-700">
                    {c.weight} pts
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
            <h4 className="font-semibold text-navy-900">Negotiation ground rules</h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-700">
              <li>Negotiate the out-the-door price first — payments last.</li>
              <li>Get every number in writing before discussing financing.</li>
              <li>Decline high-margin add-ons; they are optional, not required.</li>
              <li>Walking away is your strongest move, and it costs nothing.</li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800 print:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            Print report
          </button>
        </div>
      )}
    </div>
  );
}
