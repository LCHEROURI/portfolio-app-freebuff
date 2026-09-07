'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  loadSavedReports,
  deleteSavedReport,
  downloadSavedReport,
  reportScore,
  type SavedReport,
} from '@/lib/savedReports';

interface SavedReportsLibraryProps {
  /**
   * 'home' — compact teaser on the home page: hidden when there are no
   * reports, capped at 8 rows. 'page' — the full standalone /reports
   * library: always rendered (empty state + CTA when nothing is saved),
   * no cap (the store itself caps at MAX_SAVED_REPORTS).
   */
  variant?: 'home' | 'page';
}

/**
 * "My saved reports" library. Lists every Intelligence Report the user
 * explicitly saved from Step 11, newest first, and offers reopen (jumps back
 * into the advisor with that session's snapshot), re-download (.md / .txt),
 * and delete (with an inline confirmation). Reads straight from localStorage
 * — no backend, same as the rest of the advisor.
 */
export default function SavedReportsLibrary({ variant = 'home' }: SavedReportsLibraryProps = {}) {
  const [reports, setReports] = useState<SavedReport[] | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  useEffect(() => {
    setReports(loadSavedReports());
  }, []);

  if (reports === null) return null;
  if (variant === 'home' && reports.length === 0) return null;

  const total = reports.length;
  const shown = variant === 'page' ? reports : reports.slice(0, 8);
  const empty = total === 0;

  function handleDelete(id: string) {
    deleteSavedReport(id);
    setReports(loadSavedReports());
    setConfirmingDelete(null);
  }

  const Heading = variant === 'page' ? 'h1' : 'h2';

  return (
    <section data-testid="saved-reports-library" className={variant === 'page' ? '' : 'mb-10'}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <Heading className={variant === 'page' ? 'text-2xl font-bold text-navy-900' : 'text-xl font-semibold text-navy-900'}>
          My saved reports
        </Heading>
        <span className="text-xs text-ink-500">
          {total} saved report{total === 1 ? '' : 's'}
        </span>
      </div>

      {empty ? (
        <div data-testid="saved-reports-empty" className="rounded-xl border border-dashed border-ink-300 bg-white px-5 py-8 text-center shadow-sm">
          <p className="font-semibold text-navy-900">No saved reports yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-600">
            Finish a deal analysis and press “Save to My reports” on the final Intelligence Report —
            it will appear here, ready to reopen or download any time.
          </p>
          <Link
            href="/advisor"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800"
          >
            Start Your Deal Analysis
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map((report) => {
            const score = reportScore(report.state);
            const confirming = confirmingDelete === report.id;
            return (
              <li
                key={report.id}
                data-testid={`saved-report-${report.id}`}
                className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-navy-900">{report.title}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      Saved {new Date(report.savedAt).toLocaleString()}
                      {score !== null && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-good-100 px-2 py-0.5 font-semibold text-good-800">
                          Deal score {score}
                        </span>
                      )}
                    </p>
                  </div>
                  {!confirming ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Link
                        href={`/advisor?report=${encodeURIComponent(report.id)}`}
                        data-testid={`saved-report-open-${report.id}`}
                        className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
                      >
                        Open report
                      </Link>
                      <button
                        type="button"
                        onClick={() => downloadSavedReport(report, 'md')}
                        data-testid={`saved-report-download-${report.id}-md`}
                        className="inline-flex items-center rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 shadow-sm transition-colors hover:bg-ink-50"
                      >
                        Download .md
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadSavedReport(report, 'txt')}
                        data-testid={`saved-report-download-${report.id}-txt`}
                        className="inline-flex items-center rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 shadow-sm transition-colors hover:bg-ink-50"
                      >
                        Download .txt
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(report.id)}
                        data-testid={`saved-report-delete-${report.id}`}
                        className="inline-flex items-center rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm transition-colors hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <div
                      role="alertdialog"
                      aria-modal="false"
                      aria-labelledby={`delete-confirm-${report.id}`}
                      className="flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2"
                    >
                      <p id={`delete-confirm-${report.id}`} className="text-sm font-medium text-red-900">
                        Delete this saved report?
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleDelete(report.id)}
                          data-testid={`saved-report-delete-confirm-${report.id}`}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(null)}
                          data-testid={`saved-report-delete-cancel-${report.id}`}
                          className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
                        >
                          Keep
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {variant === 'home' && !empty && total > shown.length && (
        <p className="mt-3 text-xs text-ink-500">
          Showing the {shown.length} most recent.{' '}
          <Link href="/reports" className="font-medium text-blue-700 underline decoration-blue-200 underline-offset-2 hover:text-blue-800">
            View all saved reports
          </Link>
        </p>
      )}
    </section>
  );
}
