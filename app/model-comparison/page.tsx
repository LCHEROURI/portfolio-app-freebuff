'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Scale, Trophy, Sparkles, Check, Printer, FileCode, FileDown } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge, ModelBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useStore } from '@/lib/store';
import { buildComparison } from '@/lib/engine';
import { downloadPrintPdf, fetchWinnerRecommendation } from '@/lib/liveData';
import { modelLabel } from '@/lib/labels';
import { buildAllRecommendationsPrintDoc, buildRecommendationPrintDoc, recommendationPrintMeta, type PrintRecommendation } from '@/lib/printDoc';
import { downloadPrintHtml, usePrint } from '@/lib/usePrint';
import { type Project, type ModelEvaluation } from '@/types';

const COLUMNS = [
  ['UI', 'uiScore'],
  ['Features', 'featureScore'],
  ['Code', 'codeQualityScore'],
  ['Stability', 'stabilityScore'],
  ['Performance', 'performanceScore'],
  ['Maint.', 'maintainabilityScore'],
  ['Speed', 'developmentSpeedScore'],
  ['Cost', 'costScore'],
  ['Mobile', 'mobileScore'],
  ['A11y', 'accessibilityScore'],
] as const;

interface RecState {
  recommendedVersionId: string;
  note: string;
  model: string;
}

export default function ModelComparisonPage() {
  const store = useStore();
  const rows = buildComparison(store);
  // Shared print lifecycle for the per-project AI winner recommendation panels.
  const { printTarget, printReport } = usePrint<PrintRecommendation>(buildRecommendationPrintDoc);
  // Shared print lifecycle for the single review sheet across all projects.
  const { printTarget: allTarget, printReport: printAllRecommendations } = usePrint<PrintRecommendation[]>(buildAllRecommendationsPrintDoc);

  // Per-project AI recommendation state. Drafts are editable text the user can
  // tweak before saving onto the project.
  const [recs, setRecs] = useState<Record<string, RecState>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [hint, setHint] = useState<Record<string, boolean>>({});
  // Download-as-PDF state: the route renders the SAME shared review-sheet
  // document through headless Chrome, so the file can never drift from the
  // preview window or the Save-as-HTML export.
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const runRecommendation = async (projectId: string, projectName: string, evaluations: ModelEvaluation[]) => {
    if (loading[projectId]) return;
    const sorted = [...evaluations].sort((a, b) => b.overallScore - a.overallScore);
    const candidates = sorted.map((e) => ({
      versionId: e.projectVersionId,
      versionName: store.versions.find((v) => v.id === e.projectVersionId)?.versionName ?? e.model,
      builder: e.builder,
      model: e.model,
      overallScore: e.overallScore,
      scores: Object.fromEntries(COLUMNS.map(([label, key]) => [label, e[key]])),
    }));
    setLoading((prev) => ({ ...prev, [projectId]: true }));
    try {
      const result = await fetchWinnerRecommendation(store.userId, { projectName, candidates });
      // Graceful fallback: when OpenRouter is unconfigured or the reply can't be
      // mapped, highlight the deterministic top score with an empty editable note.
      const rec = result.recommendation
        ?? { recommendedVersionId: sorted[0].projectVersionId, note: '', model: '' };
      setRecs((prev) => ({ ...prev, [projectId]: rec }));
      setDrafts((prev) => ({ ...prev, [projectId]: rec.note }));
      if (!result.recommendation) setHint((prev) => ({ ...prev, [projectId]: true }));
    } catch {
      setRecs((prev) => ({ ...prev, [projectId]: { recommendedVersionId: sorted[0].projectVersionId, note: '', model: '' } }));
      setDrafts((prev) => ({ ...prev, [projectId]: '' }));
      setHint((prev) => ({ ...prev, [projectId]: true }));
    } finally {
      setLoading((prev) => ({ ...prev, [projectId]: false }));
    }
  };

  const saveRecommendation = async (project: Project) => {
    const note = (drafts[project.id] ?? '').trim();
    const rec = recs[project.id];
    if (!note && !project.winnerRecommendation) return;
    setSaving((prev) => ({ ...prev, [project.id]: true }));
    try {
      await store.saveProject({
        ...project,
        winnerRecommendation: note || undefined,
        winnerRecommendationModel: note ? (rec?.model ?? project.winnerRecommendationModel) : undefined,
      });
    } finally {
      setSaving((prev) => ({ ...prev, [project.id]: false }));
    }
  };

  const selectRecommended = async (project: Project) => {
    const rec = recs[project.id];
    if (!rec) return;
    const note = (drafts[project.id] ?? '').trim();
    // Select first, then save the note WITH the winner fields carried explicitly.
    // (store.selectWinner rebuilds the project from store state, so saving the
    // note before selecting would let that rebuild drop the note; and saving
    // after without carrying winningVersionId would clobber the selection.)
    await store.selectWinner(project.id, rec.recommendedVersionId);
    if (note) {
      await store.saveProject({
        ...project,
        winningVersionId: rec.recommendedVersionId,
        overallStatus: 'WINNER_SELECTED',
        winnerRecommendation: note,
        winnerRecommendationModel: rec.model || project.winnerRecommendationModel,
      });
    }
  };

  // The print payload mirrors what is on screen right now: the recommended
  // version name resolved from the live rec state, and the editable draft
  // (falling back to the saved note) so the printed text is what the user sees.
  const buildPrintRecommendation = (project: Project): PrintRecommendation => {
    const rec = recs[project.id];
    const versionId = rec?.recommendedVersionId ?? project.winningVersionId;
    return {
      projectName: project.name,
      recommendedVersionName: versionId
        ? store.versions.find((v) => v.id === versionId)?.versionName ?? '…'
        : '…',
      note: drafts[project.id] ?? project.winnerRecommendation ?? rec?.note ?? '',
      model: rec?.model ?? project.winnerRecommendationModel ?? '',
    };
  };

  // Projects with a recommendation on screen — the review sheet lists exactly
  // the panels that are visible (same condition the panels render under),
  // each with its on-screen payload (editable draft wins over the saved note).
  const recommendedProjects = rows.filter(({ project }) => recs[project.id] || project.winnerRecommendation);
  const buildAllRecommendationsPayload = (): PrintRecommendation[] =>
    recommendedProjects.map(({ project }) => buildPrintRecommendation(project));

  // The in-page fallback renders THIS document's list, so the preview window
  // and the fallback share the exact same content by construction.
  const allPrintDoc = allTarget ? buildAllRecommendationsPrintDoc(allTarget) : null;

  // Download the review sheet as a PDF through the shared /api/print/pdf route.
  // The route renders the SAME document the preview window shows, so Print,
  // Save as HTML, and Download PDF can never drift.
  const downloadPdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      await downloadPrintPdf(store.userId, buildAllRecommendationsPrintDoc(buildAllRecommendationsPayload()));
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'PDF export failed.');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Model Comparison"
        description="Side-by-side weighted scores (1–10) across every evaluated build. Pick a winner per project."
        action={
          recommendedProjects.length > 0 ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary"
                aria-label="Print all winner recommendations"
                title="One review sheet across every project's AI winner recommendation"
                onClick={() => printAllRecommendations(buildAllRecommendationsPayload())}
              >
                <Printer size={15} aria-hidden="true" /> Print all recommendations
              </button>
              <button
                type="button"
                className="btn-secondary"
                aria-label="Save all winner recommendations as HTML"
                title="Save the standalone review sheet as a shareable HTML file"
                onClick={() => downloadPrintHtml(buildAllRecommendationsPrintDoc(buildAllRecommendationsPayload()))}
              >
                <FileCode size={15} aria-hidden="true" /> Save all as HTML
              </button>
              <button
                type="button"
                className="btn-secondary"
                aria-label="Download all winner recommendations as PDF"
                title="Download the review sheet as a PDF file"
                disabled={pdfBusy}
                onClick={() => void downloadPdf()}
              >
                <FileDown size={15} aria-hidden="true" /> Download PDF
              </button>
            </div>
          ) : undefined
        }
      />

      {pdfError && (
        <p role="alert" className="mb-3 text-xs font-medium text-paprika-600 dark:text-paprika-400">
          {pdfError}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={<Scale size={32} aria-hidden="true" />} title="No evaluations yet" description="Add a Model Evaluation on a project's detail page to start comparing builders." />
      ) : (
        <div className="space-y-8">
          {rows.map(({ project, evaluations }) => {
            const sorted = [...evaluations].sort((a, b) => b.overallScore - a.overallScore);
            const winner = sorted[0];
            return (
              <Card key={project.id} className="overflow-x-auto p-0">
                <CardHeader
                  title={
                    <Link href={`/projects/${project.id}`} className="font-display text-base font-bold hover:text-tomato-600">{project.name}</Link>
                  }
                  subtitle={`${evaluations.length} build${evaluations.length === 1 ? '' : 's'} evaluated`}
                  action={
                    <div className="flex items-center gap-2">
                      {project.winningVersionId ? (
                        <Badge tone="basil"><Trophy size={12} aria-hidden="true" /> winner selected</Badge>
                      ) : (
                        <Badge tone="turmeric">winner pending</Badge>
                      )}
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        disabled={loading[project.id]}
                        aria-label={`Recommend winner for ${project.name}`}
                        onClick={() => runRecommendation(project.id, project.name, evaluations)}
                      >
                        <Sparkles size={14} className={loading[project.id] ? 'animate-pulse' : ''} aria-hidden="true" />
                        {loading[project.id] ? 'Thinking…' : 'AI Recommend'}
                      </button>
                    </div>
                  }
                />
                <table className="w-full min-w-[840px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-butter-200 text-xs uppercase tracking-wide text-pepper-400 dark:border-pepper-700">
                      <th className="px-4 py-2.5">Version</th>
                      <th className="px-2 py-2.5">Builder / Model</th>
                      {COLUMNS.map(([label]) => <th key={label} className="px-2 py-2.5 text-center">{label}</th>)}
                      <th className="px-4 py-2.5 text-center">Overall</th>
                      <th className="px-4 py-2.5">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((e) => (
                      <tr key={e.id} className={`border-b border-butter-100 last:border-0 dark:border-pepper-700 ${e.id === winner.id ? 'bg-basil-50 dark:bg-basil-950/30' : ''}`}>
                        <td className="px-4 py-2.5">
                          <p className="font-semibold">{store.versions.find((v) => v.id === e.projectVersionId)?.versionName ?? e.model}</p>
                          <p className="text-xs text-pepper-400">{e.model}</p>
                        </td>
                        <td className="px-2 py-2.5 text-xs">{e.builder}</td>
                        {COLUMNS.map(([label, key]) => (
                          <td key={label} className="px-2 py-2.5 text-center text-xs tabular-nums">{e[key]}</td>
                        ))}
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-lg font-bold tabular-nums ${e.id === winner.id ? 'text-basil-600 dark:text-basil-300' : 'text-pepper-600 dark:text-pepper-300'}`}>{e.overallScore}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          {project.winningVersionId === e.projectVersionId || store.versions.find((v) => v.id === e.projectVersionId)?.isWinner ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-basil-600 dark:text-basil-300">
                              <Trophy size={13} aria-hidden="true" /> Winner
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="text-xs font-medium text-pepper-400 underline-offset-2 hover:text-tomato-600 hover:underline"
                              onClick={() => store.selectWinner(project.id, e.projectVersionId)}
                            >
                              Select winner
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(recs[project.id] || project.winnerRecommendation) && (
                  <div className="border-t border-butter-200 px-4 py-3 dark:border-pepper-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <Sparkles size={14} className="text-eggplant-500" aria-hidden="true" />
                      <span className="text-xs font-semibold uppercase tracking-wide text-pepper-500">AI winner recommendation</span>
                      <ModelBadge model={recs[project.id]?.model ?? project.winnerRecommendationModel} />
                      {hint[project.id] && <Badge tone="turmeric">AI unavailable — top score shown</Badge>}
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        aria-label={`Print winner recommendation for ${project.name}`}
                        title="Print this recommendation"
                        onClick={() => printReport(buildPrintRecommendation(project))}
                      >
                        <Printer size={13} aria-hidden="true" /> Print
                      </button>
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        aria-label={`Save winner recommendation for ${project.name} as HTML`}
                        title="Save the standalone preview document as a shareable HTML file"
                        onClick={() => downloadPrintHtml(buildRecommendationPrintDoc(buildPrintRecommendation(project)))}
                      >
                        <FileCode size={13} aria-hidden="true" /> Save as HTML
                      </button>
                    </div>
                    {recs[project.id] && (
                      <p className="mt-1 text-xs text-pepper-500">
                        Recommended:{' '}
                        <strong>
                          {store.versions.find((v) => v.id === recs[project.id]!.recommendedVersionId)?.versionName ?? '…'}
                        </strong>
                      </p>
                    )}
                    <textarea
                      rows={3}
                      className="input-base mt-2 text-sm"
                      aria-label={`Winner recommendation note for ${project.name}`}
                      placeholder="AI note — edit freely before saving."
                      value={drafts[project.id] ?? project.winnerRecommendation ?? recs[project.id]?.note ?? ''}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [project.id]: e.target.value }))}
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={saving[project.id]}
                        onClick={() => saveRecommendation(project)}
                      >
                        <Check size={13} aria-hidden="true" /> Save note
                      </button>
                      {recs[project.id] && project.winningVersionId !== recs[project.id].recommendedVersionId && (
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          onClick={() => selectRecommended(project)}
                        >
                          <Trophy size={13} aria-hidden="true" /> Select as winner
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div className="border-t border-butter-200 px-4 py-3 text-xs text-pepper-400 dark:border-pepper-700">
                  Weights: UI 15% · Features 20% · Code 15% · Stability 15% · Perf 10% · Maint. 10% · Speed 5% · Cost 5% · Mobile 3% · A11y 2%
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Print-only area — visible ONLY in the print dialog (@media print in
          globals.css hides everything else and anchors this to the top of the
          page). Rendered only while a recommendation is being printed, so it
          never lingers in the on-screen DOM. */}
      {printTarget && (
        <div className="print-report" data-testid="print-report" aria-hidden="true">
          <h2 className="print-report-title">{printTarget.projectName} — AI winner recommendation</h2>
          <p className="print-report-meta">
            {/* Same shared builder as the preview document — never inline a copy. */}
            {recommendationPrintMeta(printTarget.recommendedVersionName)}
          </p>
          {printTarget.note && (
            <div className="print-report-summary">
              <strong>AI winner recommendation</strong>
              {/* Friendly label, not the raw model id — matches the on-screen badge. */}
              <span> ({modelLabel(printTarget.model)})</span>
              <p>{printTarget.note}</p>
            </div>
          )}
        </div>
      )}

      {/* Print-only area for the all-projects review sheet — visible ONLY in the
          print dialog (@media print in globals.css hides everything else and
          anchors this to the top of the page). Rendered only while the review
          sheet is being printed, so it never lingers in the on-screen DOM. The
          list comes from the SHARED builder, so the fallback and the preview
          window render the exact same document. */}
      {allPrintDoc && (
        <div className="print-report" data-testid="print-report-all" aria-hidden="true">
          <h2 className="print-report-title">{allPrintDoc.title}</h2>
          <p className="print-report-meta">{allPrintDoc.meta}</p>
          <ol>
            {allPrintDoc.list?.map((item) => (
              <li key={item.number}>
                <strong>{item.number}. {item.title}</strong>
                {item.project && <span> · {item.project}</span>}
                {item.detail && <p>{item.detail}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
