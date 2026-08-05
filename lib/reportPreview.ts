// ============================================================================
// Shared report-preview payload.
//
// The Reports page preview modal and /api/cron/reports?previewBody=1 both
// expose "exactly what will be emailed" for a report. Both surfaces consume
// this one shape so the page and the cron response can never disagree on
// structure. Keep this file free of server-only imports — the Reports page
// (a client component) imports the type too.
// ============================================================================

import type { TopThreeNarration, WinnerRecommendationSection } from '@/lib/openrouter';

/** A report preview: the exact emailed body plus the AI fields that produced it. */
export interface ReportPreviewPayload {
  kind: 'daily' | 'weekly';
  title: string;
  body: string;
  attentionCount: number;
  /** Model id that wrote the AI executive summary (null when none). */
  aiModel: string | null;
  /** Structured top-three narration (daily reports; null when none/fallback). */
  narration: TopThreeNarration | null;
  /**
   * Structured per-project AI winner recommendations (weekly reports). The
   * cron route always provides it; the client-side Reports preview does not
   * compute winner picks, so it stays optional here.
   */
  winnerRecommendations?: WinnerRecommendationSection[];
}
