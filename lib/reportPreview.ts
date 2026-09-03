// ============================================================================
// Shared report-preview payload.
//
// The Reports page preview modal and /api/cron/reports?previewBody=1 both
// expose exactly what a report contains. Both surfaces consume this one
// shape so the page and the cron response can never disagree on structure.
// Keep this file free of server-only imports — the Reports page (a client
// component) imports the type too.
// ============================================================================

import type { MonthlyBriefing, TopThreeNarration, WinnerRecommendationSection } from '@/lib/openrouter';

/** One deploy-failure incident (deploy failure or rollout-health event) in the weekly window. */
export interface DeployIncident {
  /** Which automation surface filed it: a deploy workflow or the scheduled rollout-health watch. */
  source: 'deploy' | 'rollout-health';
  /** The issue title, e.g. "🚨 Portfolio-app deploy failed on main (a1b2c3d)". */
  title: string;
  /** First seen (issue creation or first comment in the window). */
  firstSeenAt?: string;
  /** Last activity on the incident (latest comment or close time). */
  lastSeenAt?: string;
  /** When the incident was marked resolved, if it was. */
  resolvedAt?: string;
  /** Link to the GitHub issue for the full history. */
  url?: string;
}

/** Structured weekly incident summary: the deploy-failure issue log over the window. */
export interface IncidentsSummary {
  /** Incidents active in the window (open or resolved during it). */
  incidents: DeployIncident[];
  /** Human-readable recovery lines (issue title + resolution date). */
  recoveries: string[];
  /** Count of incidents resolved within the window. */
  resolvedCount: number;
  /** Set when the incident log could not be read (report still ships). */
  fetchError?: string;
}

/** A report preview: the exact report body plus the AI fields that produced it. */
export interface ReportPreviewPayload {
  kind: 'daily' | 'weekly' | 'monthly';
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
  /**
   * Structured monthly AI briefing (monthly reports). The cron route always
   * provides it; the client-side Reports preview does not compute a briefing,
   * so it stays optional here.
   */
  briefing?: MonthlyBriefing | null;
  /**
   * Structured deploy-incident summary (weekly reports): deploy failures and
   * rollout-health incidents from the past week, read from the shared
   * deploy-failure issue log. The cron route always provides it; the
   * client-side Reports preview does not compute it, so it stays optional.
   */
  incidentsSummary?: IncidentsSummary;
}
