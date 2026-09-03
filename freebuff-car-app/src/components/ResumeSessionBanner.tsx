'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { STORAGE_KEY, type AdvisorState } from '@/hooks/useAdvisorState';
import { STEP_LABELS, TOTAL_STEPS, type Step } from '@/lib/steps';

/**
 * Home-page banner for returning visitors: reads the advisor store from
 * localStorage after hydration and offers a one-click jump back to the saved
 * step. Renders nothing for first-time visitors or when the saved step is
 * 1 (nothing worth resuming yet).
 */
export default function ResumeSessionBanner() {
  const [saved, setSaved] = useState<AdvisorState | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as AdvisorState;
      if (parsed && typeof parsed.step === 'number' && parsed.step >= 2 && parsed.step <= TOTAL_STEPS) {
        setSaved(parsed);
      }
    } catch {
      // corrupted or unavailable storage: no banner
    }
  }, []);

  if (!saved) return null;

  const step = saved.step as Step;

  return (
    <section
      data-testid="resume-banner"
      className="mb-10 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
    >
      <div>
        <p className="font-semibold text-blue-900">Welcome back — your session was saved.</p>
        <p className="mt-1 text-sm text-blue-800">
          You were on Step {step} of {TOTAL_STEPS}: {STEP_LABELS[step]}.
        </p>
      </div>
      <Link
        href="/advisor"
        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        Resume where you left off
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      </Link>
    </section>
  );
}
