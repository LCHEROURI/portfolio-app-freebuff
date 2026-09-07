// Saved Intelligence Reports — a library of point-in-time session snapshots.
// The advisor auto-saves the *in-progress* session (useAdvisorState) but a
// finished Intelligence Report disappears once the user leaves Step 11. This
// store keeps explicit saves so a completed report can be reopened,
// re-downloaded, or deleted later from the home page.
//
// A saved report stores the full advisor session snapshot plus display
// metadata. Nothing is pre-rendered: on-screen rendering, the .md/.txt
// exporters, and re-downloads all rebuild from the snapshot through the same
// pure reportExport builders, so a reopened report can never disagree with
// the original or with the other formats.
import { buildReportMarkdown, buildReportPlainText, reportFileName } from '@/lib/reportExport';
import type { AdvisorState } from '@/hooks/useAdvisorState';

export const SAVED_REPORTS_KEY = 'freebuff-car-saved-reports-v1';
/** Hard cap so the library can't grow without bound across many sessions. */
export const MAX_SAVED_REPORTS = 20;

export interface SavedReport {
  id: string;
  savedAt: string;
  /** Short human summary shown in the library list (e.g. "Camry vs Outback"). */
  title: string;
  /** Point-in-time session snapshot; step is forced to 11 on open. */
  state: AdvisorState;
}

function rec(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function usd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

/** Vehicles the user marked for comparison, named when the snapshot has names. */
function comparedLabels(state: AdvisorState): string[] {
  const vehicles = rec(state.vehicles);
  const comparing = Array.isArray(vehicles?.comparing) ? (vehicles.comparing as unknown[]) : [];
  const names = rec(vehicles?.names);
  return comparing
    .map((id) => (typeof id === 'string' ? id : ''))
    .filter((id) => id !== '')
    .map((id) => {
      const label = names?.[id];
      return typeof label === 'string' && label.trim() !== '' ? label : id;
    });
}

/**
 * Short human summary for the library list: the compared vehicles when any
 * are saved, otherwise the monthly budget, otherwise a generic label.
 */
export function reportTitle(state: AdvisorState): string {
  const labels = comparedLabels(state);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} vs ${labels[1]}`;
  if (labels.length > 2) return `${labels[0]} vs ${labels[1]} (+${labels.length - 2} more)`;
  const intake = rec(state.intake);
  const budget = Number(intake?.monthlyBudget);
  if (Number.isFinite(budget) && budget > 0) return `Car deal · ${usd(budget)} monthly budget`;
  return 'Car deal';
}

/** Deal score embedded in the snapshot, or null when Step 10 wasn't reached. */
export function reportScore(state: AdvisorState): number | null {
  const dealScore = rec(state.dealScore);
  const result = rec(dealScore?.result);
  const score = result?.score;
  return typeof score === 'number' && Number.isFinite(score) ? score : null;
}

export function loadSavedReports(): SavedReport[] {
  try {
    const raw = window.localStorage.getItem(SAVED_REPORTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedReport[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r) => r && typeof r.id === 'string' && typeof r.savedAt === 'string')
      .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  } catch {
    // corrupted or unavailable storage: treat as empty
    return [];
  }
}

function persistSavedReports(reports: SavedReport[]): void {
  try {
    window.localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(reports));
  } catch {
    // storage full or unavailable: the in-memory list still works this visit
  }
}

/**
 * Save the current session as a report in the library. Returns the created
 * entry. Existing entries with the same id are replaced; the list stays
 * newest-first and capped at MAX_SAVED_REPORTS.
 */
export function saveAdvisorReport(
  state: AdvisorState | null | undefined,
  now = new Date().toISOString(),
): SavedReport | null {
  const snapshot = state ? (JSON.parse(JSON.stringify(state)) as AdvisorState) : null;
  if (!snapshot) return null;
  const id = `report-${now.replace(/[^0-9]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  const report: SavedReport = { id, savedAt: now, title: reportTitle(snapshot), state: snapshot };
  const next = [report, ...loadSavedReports().filter((r) => r.id !== id)].slice(0, MAX_SAVED_REPORTS);
  persistSavedReports(next);
  return report;
}

export function deleteSavedReport(id: string): void {
  persistSavedReports(loadSavedReports().filter((r) => r.id !== id));
}

export function findSavedReport(id: string): SavedReport | null {
  return loadSavedReports().find((r) => r.id === id) ?? null;
}

/** Shared anchor-download trigger (used by Step 11 and the library list). */
export function downloadTextAsFile(text: string, fileName: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Re-download a saved report — rebuilt live from its snapshot. */
export function downloadSavedReport(report: SavedReport, ext: 'md' | 'txt'): void {
  const text = ext === 'md' ? buildReportMarkdown(report.state, report.savedAt) : buildReportPlainText(report.state, report.savedAt);
  const fileName = reportFileName(report.savedAt, ext, report.state);
  const mime = ext === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
  downloadTextAsFile(text, fileName, mime);
}
