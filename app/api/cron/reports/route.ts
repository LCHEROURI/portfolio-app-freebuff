import { NextResponse, type NextRequest } from 'next/server';

import {
  buildDailyReportBody, buildMonthlyBriefingFacts, buildMonthlyReportBody,
  buildTopThree, buildWeeklyReportBody, buildWinnerCandidates,
  runAutomationRules,
  type AppState, type AutomationAlert,
} from '@/lib/engine';
import {
  narrateMonthlyBriefing, narrateTopThree, recommendWinner, summarizeReport,
  withExecutiveSummary, withMonthlyBriefing, withTopThreeNarration,
  withWinnerRecommendations,
  type WinnerRecommendationSection,
} from '@/lib/openrouter';
import type { IncidentsSummary, ReportPreviewPayload } from '@/lib/reportPreview';
import { loadLiveSnapshot, serverProfile } from '@/lib/server/reporting/data';
import { fetchIncidentsSummary } from '@/lib/server/incidents';
import {
  FIRESTORE_COLLECTIONS, firestoreUpsert, isFirestoreAdminConfigured,
} from '@/lib/server/firestoreAdmin';

// ============================================================================
// GET /api/cron/reports — automation engine entry point.
//
// Vercel Cron invokes this daily (see vercel.json) and automatically attaches
// `Authorization: Bearer <CRON_SECRET>`; the route verifies it and returns 401
// for anything else, so the endpoint is not publicly triggerable.
//
// Behavior:
//   ?kind=auto   (default) → daily report every run; weekly report when the UTC
//                            weekday matches REPORT_WEEKLY_DAY (default 1=Mon);
//                            monthly report when the UTC day-of-month matches
//                            REPORT_MONTHLY_DAY (default 1)
//   ?kind=daily / ?kind=weekly / ?kind=monthly → force just that report
//                            (for manual testing)
//   ?previewBody=1 → dev-only: include each report's composed body in the
//                    JSON response (still requires the CRON_SECRET bearer), so
//                    the exact report text can be verified without opening an
//                    inbox. Omitted by default to keep the response lean.
//   ?previewBody=1&format=text → dev-only plain-text preview: returns the
//                    composed body as text/plain, so the exact text can be
//                    piped into a file or viewer without waiting for the
//                    scheduled cron.
//
// Reports are composed in-app only: the route composes the report bodies
// (exposed via ?previewBody=1 / format=text for the in-app Reports page and
// the verification suite) but never sends anything — no email envelope rides
// on the response.
//
// Each run still logs a `report_generated` activity doc to the Firestore
// activity collection when the service account is configured, so the Activity
// page shows when the automation engine generated reports.
//
// The 14 automation rules run against a live snapshot (Firestore tasks/projects/
// versions/evaluations + live GitHub repos + Vercel/Firebase deployments) using
// the exact same engine as the UI, then the composed report is saved for the
// in-app Reports page and the verification suite.
// ============================================================================

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Append the fired 14-rule alerts to a report body so they surface in it. */
const withAlertsSection = (body: string, alerts: AutomationAlert[]): string => {
  if (alerts.length === 0) return body;
  const lines = [
    '',
    '## ⚠️ Automation alerts (14 rules)',
    ...alerts.map((a) =>
      `- **[${a.severity.toUpperCase()}] Rule ${a.ruleNumber}** — ${a.title}: ${a.description}`,
    ),
  ];
  return `${body}\n${lines.join('\n')}`;
};

/**
 * Append the weekly deploy-incident summary to a report body. Renders one line
 * per incident (source-tagged, linked to its issue) plus a recoveries line;
 * a quiet week renders a clean "no incidents" line and an unreadable log says
 * so explicitly — never silently blank. null → body unchanged (non-weekly).
 */
const withIncidentsSummary = (
  body: string,
  summary: IncidentsSummary | null,
): string => {
  if (!summary) return body;
  const lines: string[] = [
    '',
    '## 🚨 Deploy incidents this week',
  ];
  if (summary.fetchError) {
    lines.push(`- Incident log unavailable (${summary.fetchError}) — check GitHub API access.`);
  } else if (summary.incidents.length === 0) {
    lines.push('- None — no deploy failures or rollout-health incidents in the past 7 days. 🎉');
  } else {
    lines.push(
      ...summary.incidents.map((i) => {
        const when = i.firstSeenAt ? ` (first seen ${i.firstSeenAt.slice(0, 10)}${i.resolvedAt ? `, resolved ${i.resolvedAt.slice(0, 10)}` : ', still open at last report'})` : '';
        const link = i.url ? ` — [issue history](${i.url})` : '';
        return `- **[${i.source}]** ${i.title}${when}${link}`;
      }),
    );
  }
  lines.push(
    summary.resolvedCount > 0
      ? `- Recovered this week: ${summary.resolvedCount} incident(s) resolved.`
      : '- No recoveries recorded this week.',
  );
  return `${body}\n${lines.join('\n')}`;
};

export async function GET(req: NextRequest) {
  // 1. Verify the Vercel Cron secret.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  // 2. Resolve run parameters.
  const ownerId = process.env.REPORT_OWNER_ID ?? 'demo-user';
  const rawKind = req.nextUrl.searchParams.get('kind') ?? 'auto';
  const kind: 'auto' | 'daily' | 'weekly' | 'monthly' =
    rawKind === 'daily' || rawKind === 'weekly' || rawKind === 'monthly' ? rawKind : 'auto';
  // Dev-only verification aid: include the composed report body in the response.
  const previewBody = req.nextUrl.searchParams.get('previewBody') === '1';
  // Dev-only plain-text preview: when set, the composed body is returned as
  // text/plain.
  const textPreview = previewBody && req.nextUrl.searchParams.get('format') === 'text';
  const weeklyDay = Number(process.env.REPORT_WEEKLY_DAY ?? 1);
  // Monthly cadence is by UTC day-of-month (1-31; values past the last day of
  // a short month simply never match, so the cron skips that month cleanly).
  const monthlyDay = Number(process.env.REPORT_MONTHLY_DAY ?? 1);
  const todayUtc = new Date().getUTCDay();
  const todayUtcDate = new Date().getUTCDate();

  // 3. Assemble the live snapshot and evaluate the 14 rules.
  const snapshot = await loadLiveSnapshot(ownerId);
  const state: AppState = {
    profile: serverProfile(ownerId),
    ...snapshot.collections,
    activity: [],
  };
  const alerts = runAutomationRules(state);

  const totalData =
    snapshot.collections.tasks.length + snapshot.collections.projects.length +
    snapshot.collections.repositories.length + snapshot.collections.deployments.length;

  // 4. Skip report noise before any live source is wired up.
  if (totalData === 0) {
    return NextResponse.json({
      ok: true,
      note: 'No live data configured — nothing to report yet. Wire Firestore/GitHub/Vercel env vars first.',
      ownerId,
      configured: snapshot.configured,
    });
  }

  const wantDaily = kind === 'auto' || kind === 'daily';
  const wantWeekly = kind === 'auto' ? todayUtc === weeklyDay : kind === 'weekly';
  const wantMonthly = kind === 'auto' ? todayUtcDate === monthlyDay : kind === 'monthly';
  // Each report entry carries the shared preview payload (kind/title/body/
  // attentionCount/aiModel/narration) so the ?previewBody=1 response and the
  // Reports page preview modal agree on structure by construction.
  const reports: Array<ReportPreviewPayload & {
    narrationModel: string | null;
  }> = [];

  // AI executive summary is an enhancement: when OpenRouter is unconfigured or
  // the call fails, summarizeReport / narrateTopThree return null and the report
  // body is returned unchanged (deterministic text + alerts). Both AI calls for a
  // report run in parallel so two slow calls can't eat the whole cron maxDuration
  // budget.
  const pending: Array<{
    r: { title: string; body: string; attentionCount: number };
    kind: 'daily' | 'weekly' | 'monthly';
  }> = [];
  if (wantDaily) pending.push({ r: buildDailyReportBody(state), kind: 'daily' });
  if (wantWeekly) pending.push({ r: buildWeeklyReportBody(state), kind: 'weekly' });
  if (wantMonthly) pending.push({ r: buildMonthlyReportBody(state), kind: 'monthly' });

  // Weekly AI winner recommendations: projects with multiple active versions,
  // no winner, and evaluations (rule 10). Bounded to 3 projects so a slow
  // provider can't eat the cron budget; graceful null → section omitted.
  const winnerCandidates = wantWeekly ? buildWinnerCandidates(state) : [];

  // Deterministic top three, computed once — the same actions the dashboard
  // shows — so the AI narration in the report matches the UI briefing. The
  // narration, like the executive summary, uses the OPENROUTER_MODEL env default
  // (the per-user Settings picker applies to the UI only), keeping the two AI
  // sections of the report consistent with each other.
  const topThree = wantDaily ? buildTopThree(state) : [];
  // Pass the same project identity the dashboard briefing uses (cite-backs),
  // resolving names from the snapshot so the narration can be as
  // specific as the UI one.
  const projectNameOf = (id: string | undefined) =>
    id ? state.projects.find((p) => p.id === id)?.name : undefined;
  const topThreeActions = topThree.map((a) => ({
    priority: a.priority,
    title: a.title,
    description: a.description,
    projectId: a.projectId,
    projectName: projectNameOf(a.projectId),
  }));

  // Per-project AI winner picks (weekly only, rule 10), computed once and in
  // parallel with the summaries; bounded to 3 projects so a slow provider can't
  // eat the cron budget. Graceful null → section omitted.
  const buildWinnerSections = async (): Promise<WinnerRecommendationSection[]> => {
    if (!wantWeekly || winnerCandidates.length === 0) return [];
    const rows = await Promise.all(winnerCandidates.map(async (c): Promise<WinnerRecommendationSection | null> => {
      const rec = await recommendWinner({ projectName: c.projectName, candidates: c.candidates });
      if (!rec) return null;
      const versionName =
        c.candidates.find((x) => x.versionId === rec.recommendedVersionId)?.versionName
        ?? rec.recommendedVersionId;
      return { projectName: c.projectName, versionName, note: rec.note, model: rec.model };
    }));
    return rows.filter((r): r is WinnerRecommendationSection => r !== null);
  };

  const winnerPromise = buildWinnerSections();

  // The deterministic monthly facts, computed once when the monthly report is
  // due — the AI briefing narrates exactly these figures (never invented ones).
  const monthlyFacts = wantMonthly ? buildMonthlyBriefingFacts(state) : null;

  // Weekly incident summary: the shared deploy-failure issue log is the
  // durable record of deploy failures AND rollout-health incidents, so the
  // weekly report summarizes it over the past 7 days. Computed once when a
  // weekly report is due, in parallel with the summaries; every failure mode
  // degrades to an empty summary (with fetchError) so the report never fails
  // because this section is missing.
  const incidentsPromise: Promise<IncidentsSummary | null> = wantWeekly
    ? fetchIncidentsSummary(7).catch(
        (): IncidentsSummary => ({
          incidents: [], recoveries: [], resolvedCount: 0,
          fetchError: 'incident fetch failed',
        }),
      )
    : Promise.resolve(null);

  const summarized = await Promise.all(pending.map(async ({ r, kind }) => {
    const ai = await summarizeReport({ kind, title: r.title, body: r.body, attentionCount: r.attentionCount });
    // The 'why these three matter today' briefing is a daily feature; weekly
    // reports keep the executive summary + winner recommendation; monthly
    // reports get the velocity/trends/drift briefing instead.
    const narration = kind === 'daily'
      ? await narrateTopThree({ actions: topThreeActions })
      : null;
    const briefing = kind === 'monthly' && monthlyFacts
      ? await narrateMonthlyBriefing({ facts: monthlyFacts })
      : null;
    // Awaited inside the map so weekly bodies always render the freshest winner
    // sections; the promise is computed once, in parallel with the summaries.
    const winnerSections = await winnerPromise;
    const incidentsSummary = await incidentsPromise;
    let body = withExecutiveSummary(withAlertsSection(r.body, alerts), ai?.summary ?? null, ai?.model ?? null);
    if (kind === 'daily') {
      body = withTopThreeNarration(body, narration?.paragraph ?? null, narration?.model ?? null);
    }
    if (kind === 'monthly') {
      body = withMonthlyBriefing(body, briefing?.paragraph ?? null, briefing?.model ?? null);
    }
    if (kind === 'weekly') {
      body = withWinnerRecommendations(body, winnerSections);
      body = withIncidentsSummary(body, incidentsSummary);
    }
    return {
      kind,
      title: r.title,
      attentionCount: r.attentionCount,
      body,
      model: ai?.model ?? null,
      // Structured narration (daily only) so verifiers can assert the exact
      // paragraph and model without parsing the composed body text.
      narration,
      // Structured winner recommendations (weekly only) for the same reason.
      winnerRecommendations: winnerSections,
      // Structured monthly briefing (monthly only) for the same reason.
      briefing,
      // Structured incident summary (weekly only) for the same reason.
      incidentsSummary,
    };
  }));

  for (const s of summarized) {
    // Reports are composed in-app — no email envelope rides on the response
    // (the body rides along only when ?previewBody=1 asks).
    reports.push({
      kind: s.kind, title: s.title, attentionCount: s.attentionCount,
      aiModel: s.model, narrationModel: s.narration?.model ?? null,
      // The full preview payload (body + structured narration/briefing) rides
      // along so the shared ReportPreviewPayload type is always satisfied; the
      // response below strips the heavy fields unless ?previewBody=1 asks.
      body: s.body,
      narration: s.narration,
      winnerRecommendations: s.winnerRecommendations,
      briefing: s.briefing,
      incidentsSummary: s.incidentsSummary ?? undefined,
    });

    // Log a report_generated activity doc (Firestore, camelCase like the client
    // FirestoreService) so the Activity page shows the delivery history.
    // Best-effort: never fail the cron on a log write.
    if (isFirestoreAdminConfigured()) {
      try {
        await firestoreUpsert(FIRESTORE_COLLECTIONS.activity, {
          id: `a-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          userId: ownerId,
          kind: 'report_generated',
          message: `${s.kind} report "${s.title}" generated`,
          createdAt: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('activity log skipped (cron):', e instanceof Error ? e.message : e);
      }
    }
  }

  // Dev-only plain-text preview: serve the composed body as text/plain
  // instead of JSON — the exact report text is now curl-able / pipe-able
  // without waiting for the schedule.
  if (textPreview) {
    const target =
      reports.find((r) => r.kind === (kind === 'weekly' ? 'weekly' : 'daily')) ?? reports[0];
    if (!target) {
      return NextResponse.json({ ok: true, note: 'No report composed for the requested kind.' });
    }
    return new NextResponse(target.body, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Each report entry carries the shared preview payload (kind/title/body/
  // attentionCount/aiModel/narration) so the ?previewBody=1 response and the
  // Reports page preview modal agree on structure by construction. Without the
  // dev-only flag the body + narration are stripped from the response (they're
  // heavy and verifiable only via an inbox), keeping the default JSON lean.
  const responseReports = previewBody
    ? reports
    : reports.map((r) => ({
        kind: r.kind, title: r.title, attentionCount: r.attentionCount,
        aiModel: r.aiModel, narrationModel: r.narrationModel,
      }));

  return NextResponse.json({
    ok: true,
    ownerId,
    kind,
    configured: snapshot.configured,
    counts: {
      projects: snapshot.collections.projects.length,
      versions: snapshot.collections.versions.length,
      repositories: snapshot.collections.repositories.length,
      deployments: snapshot.collections.deployments.length,
      tasks: snapshot.collections.tasks.length,
      evaluations: snapshot.collections.evaluations.length,
    },
    alerts: alerts.map((a) => ({ rule: a.ruleNumber, severity: a.severity, title: a.title })),
    reports: responseReports,
  });
}
