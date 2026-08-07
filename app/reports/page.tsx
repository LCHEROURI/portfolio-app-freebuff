'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileDown, FileText, RefreshCw, Clock4, Sparkles, CalendarClock, Trash2, Printer } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge, ModelBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { LastScanStrip } from '@/components/dashboard/LastScanStrip';
import { useStore } from '@/lib/store';
import { downloadPrintPdf, fetchAiSummary } from '@/lib/liveData';
import { buildDailyReportBody, buildWeeklyReportBody, timeAgo } from '@/lib/engine';
import { modelLabel } from '@/lib/labels';
import { reportPrintMeta, type PrintDoc } from '@/lib/printDoc';
import { usePrint } from '@/lib/usePrint';
import type { ReportPreviewPayload } from '@/lib/reportPreview';
import type { Report } from '@/types';

// A report preview is the shared payload the cron's ?previewBody=1 also emits
// (kind/title/body/attentionCount/aiModel/narration) plus the client-only
// executive-summary text (shown as a callout) and a UI flag marking whether the
// preview came from a fresh Generate (still needs a Save click) vs. one
// re-opened from an already-saved report (Close only).
type ReportPreview = ReportPreviewPayload & {
  aiSummary?: string;
  pendingSave: boolean;
};

// The minimal payload the print-only area needs to reproduce a report on
// paper. Both the preview modal and the saved-report rows hand this over —
// print never touches the data layer, it just snapshots what is on screen.
// Derived from the Report type so the print payload can never drift from a
// report field rename; aiModel is widened to accept the preview's null.
type PrintReport = Pick<Report, 'kind' | 'title' | 'body' | 'attentionCount' | 'aiSummary'> & {
  aiModel?: string | null;
  createdAt?: string;
};

// Map the on-screen report to the shared print-preview document. The AI
// executive summary becomes a callout with the friendly model label; the body
// is the monospace report body. All text is escaped when the preview window is
// written, so report bodies can never inject markup.
const buildPrintDoc = (payload: PrintReport): PrintDoc => ({
  title: payload.title,
  // Shared builder — the in-page .print-report fallback below calls the same
  // function, so the two render paths can never drift.
  meta: reportPrintMeta({
    kind: payload.kind,
    attentionCount: payload.attentionCount,
    ageLabel: payload.createdAt ? timeAgo(payload.createdAt) : undefined,
  }),
  callouts: payload.aiSummary
    ? [{ heading: 'AI executive summary', label: payload.aiModel ? modelLabel(payload.aiModel) : undefined, text: payload.aiSummary }]
    : [],
  body: payload.body,
});

// The exact PrintReport both Print and Download PDF act on — one builder per
// surface (preview modal vs. saved rows) so the two actions can never drift.
const modalPrint = (p: ReportPreview): PrintReport => ({
  kind: p.kind,
  title: p.title,
  body: p.body,
  attentionCount: p.attentionCount,
  aiSummary: p.aiSummary,
  aiModel: p.aiModel,
});

const rowPrint = (r: Report): PrintReport => ({
  kind: r.kind,
  title: r.title,
  body: r.body,
  attentionCount: r.attentionCount,
  aiSummary: r.aiSummary,
  aiModel: r.aiModel ?? null,
  createdAt: r.createdAt,
});

export default function ReportsPage() {
  const store = useStore();
  const [generating, setGenerating] = useState<'daily' | 'weekly' | null>(null);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Shared print lifecycle: prefers a styled preview window (popup-blocked
  // falls back to the in-page .print-report area + window.print).
  const { printTarget, printReport } = usePrint<PrintReport>(buildPrintDoc);
  // Download-as-PDF state: the route renders the SAME buildPrintDoc through
  // headless Chrome, so the file can never drift from the preview.
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const downloadPdf = async (payload: PrintReport) => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      await downloadPrintPdf(store.userId, buildPrintDoc(payload));
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'PDF export failed.');
    } finally {
      setPdfBusy(false);
    }
  };

  // Build the report and open a preview modal instead of saving immediately, so
  // the user sees the exact report body (freshness section + AI summary)
  // before it is saved.
  const buildPreview = async (kind: 'daily' | 'weekly') => {
    setGenerating(kind);
    const built = kind === 'daily'
      ? buildDailyReportBody(store)
      : buildWeeklyReportBody(store);
    // AI executive summary is an enhancement: when OpenRouter is unconfigured
    // or the call fails, the deterministic report body is previewed unchanged.
    let aiSummary: string | undefined;
    let aiModel: string | undefined;
    try {
      const ai = await fetchAiSummary(store.userId, {
        kind,
        title: built.title,
        body: built.body,
        attentionCount: built.attentionCount,
        // Per-user model preference from Settings → AI summaries. The route falls
        // back to OPENROUTER_MODEL when empty, so the model badge on each saved
        // report reflects exactly which model wrote that summary. Normalize the
        // cleared preference to undefined so no meaningless empty field is sent.
        model: store.profile.aiModel || undefined,
      });
      if (ai.summary) {
        aiSummary = ai.summary;
        aiModel = ai.model ?? undefined;
      }
    } catch {
      // Fall back to the deterministic body.
    }
    setPreview({
      kind,
      title: built.title,
      body: built.body,
      attentionCount: built.attentionCount,
      aiSummary,
      aiModel: aiModel ?? null,
      narration: null,
      pendingSave: true,
    });
    setConfirmDiscard(false);
    setGenerating(null);
  };

  const savePreview = async () => {
    if (!preview) return;
    await store.saveReport({
      id: `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      userId: store.userId,
      kind: preview.kind,
      title: preview.title,
      body: preview.body,
      attentionCount: preview.attentionCount,
      createdAt: new Date().toISOString(),
      aiSummary: preview.aiSummary,
      aiModel: preview.aiModel ?? undefined,
    });
    setPreview(null);
  };

  // A freshly generated preview holds unsaved work, so an accidental Discard
  // (or the modal's X / backdrop / Escape) asks once before throwing it away.
  const requestClose = () => {
    if (preview?.pendingSave && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setConfirmDiscard(false);
    setPreview(null);
  };

  const recent = store.reports.slice(0, 8);

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Daily and weekly snapshots of attention items, tasks, deployments, and model performance."
        action={
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={generating !== null} onClick={() => buildPreview('daily')}>
              <RefreshCw size={15} className={generating === 'daily' ? 'animate-spin' : ''} aria-hidden="true" /> Generate Daily
            </button>
            <button type="button" className="btn-primary" disabled={generating !== null} onClick={() => buildPreview('weekly')}>
              <RefreshCw size={15} className={generating === 'weekly' ? 'animate-spin' : ''} aria-hidden="true" /> Generate Weekly
            </button>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 text-sm sm:grid-cols-2">
        <Card className="flex items-center gap-3">
          <Clock4 size={18} className="shrink-0 text-turmeric-500" aria-hidden="true" />
          <p className="text-pepper-600 dark:text-pepper-200">
            <strong>Daily report</strong> — {store.profile.dailyReportEnabled ? `auto-sends at ${store.profile.dailyReportTime}` : 'disabled in settings'}.
          </p>
        </Card>
        <Card className="flex items-center gap-3">
          <Clock4 size={18} className="shrink-0 text-eggplant-500" aria-hidden="true" />
          <p className="text-pepper-600 dark:text-pepper-200">
            <strong>Weekly report</strong> — {store.profile.weeklyReportEnabled ? `day ${store.profile.weeklyReportDay} at ${store.profile.weeklyReportTime}` : 'disabled in settings'}.
          </p>
        </Card>
      </div>

      {/* Local scan freshness — newest/oldest lastScannedAt across repos, so
          the newest/oldest/stale picture is visible before generating a report
          (the same block the report body renders in its header). The schedule
          link jumps to the Settings scan-schedule card. */}
      <LastScanStrip
        headerAction={
          <Link href="/settings#scan-schedule" className="btn-ghost px-2 py-1 text-xs" title="Open the launchd/cron scan schedule in Settings">
            <CalendarClock size={12} aria-hidden="true" /> Schedule
          </Link>
        }
      />

      {recent.length === 0 ? (
        <EmptyState icon={<FileText size={32} aria-hidden="true" />} title="No reports yet" description="Generate a daily or weekly report to see it here." />
      ) : (
        <div className="space-y-4">
          {recent.map((r) => (
            <details key={r.id} className="card-base group">
              <summary className="flex cursor-pointer list-none items-center gap-3">
                <Badge tone={r.kind === 'daily' ? 'turmeric' : 'eggplant'}>{r.kind}</Badge>
                <span className="flex-1 font-semibold">{r.title}</span>
                <span className="text-xs text-pepper-400">{r.attentionCount} attention items · {timeAgo(r.createdAt)}</span>
                <button
                  type="button"
                  aria-label={`Preview body of ${r.title}`}
                  className="btn-ghost rounded-md px-2 py-1 text-xs"
                  onClick={(e) => {
                    // Don't toggle the <details> — only open the preview modal.
                    e.preventDefault();
                    e.stopPropagation();
                    setConfirmDiscard(false);
                    setPreview({
                      kind: r.kind,
                      title: r.title,
                      body: r.body,
                      attentionCount: r.attentionCount,
                      aiSummary: r.aiSummary,
                      aiModel: r.aiModel ?? null,
                      narration: null,
                      pendingSave: false,
                    });
                  }}
                >
                  <FileText size={12} aria-hidden="true" /> Preview body
                </button>
                <button
                  type="button"
                  aria-label={`Print ${r.title}`}
                  className="btn-ghost rounded-md px-2 py-1 text-xs"
                  title="Print this report"
                  onClick={(e) => {
                    // Don't toggle the <details> — just print.
                    e.preventDefault();
                    e.stopPropagation();
                    printReport(rowPrint(r));
                  }}
                >
                  <Printer size={12} aria-hidden="true" /> Print
                </button>
                <button
                  type="button"
                  aria-label={`Download PDF of ${r.title}`}
                  className="btn-ghost rounded-md px-2 py-1 text-xs"
                  title="Download this report as a PDF file"
                  disabled={pdfBusy}
                  onClick={(e) => {
                    // Don't toggle the <details> — just download.
                    e.preventDefault();
                    e.stopPropagation();
                    void downloadPdf(rowPrint(r));
                  }}
                >
                  <FileDown size={12} aria-hidden="true" /> Download PDF
                </button>
              </summary>
              {r.aiSummary && (
                <div className="mt-4 rounded-xl2 border border-eggplant-200 bg-eggplant-50 p-4 dark:border-eggplant-800 dark:bg-eggplant-950/60">
                  <div className="mb-1 flex items-center gap-2">
                    <Sparkles size={14} className="text-eggplant-600 dark:text-eggplant-300" aria-hidden="true" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-eggplant-700 dark:text-eggplant-300">
                      AI executive summary
                    </span>
                    <ModelBadge model={r.aiModel} />
                  </div>
                  <p className="text-sm leading-relaxed text-pepper-700 dark:text-pepper-200">{r.aiSummary}</p>
                </div>
              )}
              <pre className="mt-4 overflow-x-auto rounded-xl2 bg-pepper-900 p-4 font-mono text-xs leading-relaxed text-flour-50 scrollbar-thin">{r.body}</pre>
            </details>
          ))}
        </div>
      )}

      {/* Preview modal — the exact report body (freshness section included)
          plus the AI summary, shown BEFORE saving a freshly generated report
          or when re-opening a saved one via its 'Preview body' button. */}
      {preview && (
        <Modal
          open
          onClose={requestClose}
          title={`Preview ${preview.kind} report`}
          description="This is exactly what the report will contain — including the Local scan freshness section and any AI executive summary."
          wide
        >
          {preview.aiSummary && (
            <div className="mb-4 rounded-xl2 border border-eggplant-200 bg-eggplant-50 p-4 dark:border-eggplant-800 dark:bg-eggplant-950/60">
              <div className="mb-1 flex items-center gap-2">
                <Sparkles size={14} className="text-eggplant-600 dark:text-eggplant-300" aria-hidden="true" />
                <span className="text-xs font-semibold uppercase tracking-wide text-eggplant-700 dark:text-eggplant-300">
                  AI executive summary
                </span>
                <ModelBadge model={preview.aiModel} />
              </div>
              <p className="text-sm leading-relaxed text-pepper-700 dark:text-pepper-200">{preview.aiSummary}</p>
            </div>
          )}
          <pre className="max-h-96 overflow-x-auto overflow-y-auto rounded-xl2 bg-pepper-900 p-4 font-mono text-xs leading-relaxed text-flour-50 scrollbar-thin">{preview.body}</pre>
          <div className="mt-4 space-y-3">
            {preview.pendingSave && confirmDiscard && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl2 border border-paprika-200 bg-paprika-50 p-3 dark:border-paprika-800 dark:bg-paprika-950/60">
                <p className="text-sm font-medium text-paprika-700 dark:text-paprika-200">
                  Discard this generated report? It hasn&apos;t been saved.
                </p>
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost text-sm" onClick={() => setConfirmDiscard(false)}>
                    Keep editing
                  </button>
                  <button type="button" className="btn-danger text-sm" onClick={() => { setConfirmDiscard(false); setPreview(null); }}>
                    <Trash2 size={14} aria-hidden="true" /> Discard report
                  </button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={pdfBusy}
                onClick={() => void downloadPdf(modalPrint(preview))}
              >
                <FileDown size={15} aria-hidden="true" /> Download PDF
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => printReport(modalPrint(preview))}
              >
                <Printer size={15} aria-hidden="true" /> Print report
              </button>
              {preview.pendingSave ? (
                <>
                  <button type="button" className="btn-ghost" onClick={requestClose}>
                    Discard
                  </button>
                  <button type="button" className="btn-primary" onClick={() => void savePreview()}>
                    <FileText size={15} aria-hidden="true" /> Save report
                  </button>
                </>
              ) : (
                <button type="button" className="btn-ghost" onClick={requestClose}>
                  Close
                </button>
              )}
            </div>
            {pdfError && (
              <p role="alert" className="text-xs font-medium text-paprika-600 dark:text-paprika-400">
                {pdfError}
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* Print-only area — visible ONLY in the print dialog (@media print in
          globals.css hides everything else and anchors this to the top of the
          page). Rendered only while a report is being printed, so it never
          lingers in the on-screen DOM. */}
      {printTarget && (
        <div className="print-report" data-testid="print-report" aria-hidden="true">
          <h2 className="print-report-title">{printTarget.title}</h2>
          <p className="print-report-meta">
            {/* Same shared builder as the preview document — never inline a copy. */}
            {reportPrintMeta({
              kind: printTarget.kind,
              attentionCount: printTarget.attentionCount,
              ageLabel: printTarget.createdAt ? timeAgo(printTarget.createdAt) : undefined,
            })}
          </p>
          {printTarget.aiSummary && (
            <div className="print-report-summary">
              <strong>AI executive summary</strong>
              {printTarget.aiModel && <span> ({modelLabel(printTarget.aiModel)})</span>}
              <p>{printTarget.aiSummary}</p>
            </div>
          )}
          <pre>{printTarget.body}</pre>
        </div>
      )}
    </div>
  );
}
