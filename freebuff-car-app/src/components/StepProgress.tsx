'use client';

import { useEffect, useState } from 'react';
import { completedStepCount, REPORT_STORAGE_KEY } from '@/lib/progress';
import { TOTAL_STEPS } from '@/lib/steps';
import type { AdvisorState } from '@/hooks/useAdvisorState';

/**
 * Advisor-header progress meter: "N of 11 steps completed" with a bar,
 * derived from which steps have saved data in the persisted store (not from
 * the current step position). Re-checks the report-generated marker whenever
 * the store object changes, so generating the Intelligence Report bumps it
 * to 11/11 immediately.
 */
export default function StepProgress({ advisor }: { advisor: AdvisorState }) {
  const [reportGenerated, setReportGenerated] = useState(false);

  useEffect(() => {
    try {
      setReportGenerated(!!window.localStorage.getItem(REPORT_STORAGE_KEY));
    } catch {
      // storage unavailable: report step just stays uncounted
    }
  }, [advisor]);

  const done = completedStepCount(advisor, reportGenerated);
  const pct = Math.round((done / TOTAL_STEPS) * 100);

  return (
    <div data-testid="step-progress" className="shrink-0 sm:w-48">
      <p className="text-xs font-semibold text-navy-900">
        {done} of {TOTAL_STEPS} steps completed
      </p>
      <div
        role="progressbar"
        aria-label="Advisor progress"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={TOTAL_STEPS}
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-200"
      >
        <div
          className="h-full rounded-full bg-blue-600 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
