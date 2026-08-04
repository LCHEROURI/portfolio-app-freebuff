'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileText, RefreshCw, Clock4, Sparkles, CalendarClock, Send, Trash2 } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge, ModelBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { LastScanStrip } from '@/components/dashboard/LastScanStrip';
import { useStore } from '@/lib/store';
import { fetchAiSummary, sendReportNow } from '@/lib/liveData';
import { buildDailyReportBody, buildWeeklyReportBody, timeAgo } from '@/lib/engine';
import type { ReportPreviewPayload } from '@/lib/reportPreview';

// A report preview is the shared payload the cron's ?previewBody=1 also emits
// (kind/title/body/attentionCount/aiModel/narration) plus the client-only
// executive-summary text (shown as a callout) and a UI flag marking whether the
// preview came from a fresh Generate (still needs a Save click) vs. one
// re-opened from an already-saved report (Close only).
type ReportPreview = ReportPreviewPayload & {
  aiSummary?: string;
  pendingSave: boolean;
};

export default function ReportsPage() {
  const store = useStore();
  const [generating, setGenerating] = useState<'daily' | 'weekly' | null>(null);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<string | null>(null);

  // Build the report and open a preview modal instead of saving immediately, so
  // the user sees the exact emailed body (freshness section + AI summary)
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
    setSendNote(null);
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

  // Save the report AND immediately deliver it via /api/reports/send — the same
  // Resend client the scheduled cron uses, but user-authenticated so the browser
  // can trigger it. Emailing is graceful: an unconfigured provider still saves
  // the report and reports why the email was skipped.
  const saveAndEmailNow = async () => {
    if (!preview) return;
    setSending(true);
    setSendNote(null);
    try {
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
      const res = await sendReportNow(store.userId, {
        kind: preview.kind,
        title: preview.title,
        body: preview.body,
        attentionCount: preview.attentionCount,
        aiSummary: preview.aiSummary,
        aiModel: preview.aiModel,
      });
      setSendNote(res.sent ? 'Emailed ✓' : `Saved — email skipped: ${res.reason ?? 'not configured'}.`);
    } catch {
      setSendNote('Saved — email delivery failed.');
    } finally {
      setSending(false);
      // The report is saved either way, so the preview flips to view-only
      // (Close instead of Save) — an accidental second 'Save report' click can
      // never write a duplicate row.
      setPreview((p) => (p ? { ...p, pendingSave: false } : p));
    }
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
          (the same block the emailed body renders in its header). The schedule
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
                    setSendNote(null);
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

      {/* Preview modal — the exact emailed body (freshness section included)
          plus the AI summary, shown BEFORE saving a freshly generated report
          or when re-opening a saved one via its 'Preview body' button. */}
      {preview && (
        <Modal
          open
          onClose={requestClose}
          title={`Preview ${preview.kind} report`}
          description="This is exactly what the emailed body will contain — including the Local scan freshness section and any AI executive summary."
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
            {sendNote && (
              <p className="text-sm text-pepper-600 dark:text-pepper-300" role="status">{sendNote}</p>
            )}
            <div className="flex justify-end gap-2">
              {preview.pendingSave ? (
                <>
                  <button type="button" className="btn-ghost" onClick={requestClose}>
                    Discard
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => void savePreview()}>
                    <FileText size={15} aria-hidden="true" /> Save report
                  </button>
                  <button type="button" className="btn-primary" disabled={sending} onClick={() => void saveAndEmailNow()}>
                    <Send size={15} className={sending ? 'animate-pulse' : ''} aria-hidden="true" />
                    {sending ? 'Saving & sending…' : 'Save and email now'}
                  </button>
                </>
              ) : (
                <button type="button" className="btn-ghost" onClick={requestClose}>
                  Close
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
