import { NextResponse, type NextRequest } from 'next/server';

import {
  buildDailyReportBody, buildTopThree, buildWeeklyReportBody, runAutomationRules,
  type AppState, type AutomationAlert,
} from '@/lib/engine';
import { narrateTopThree, summarizeReport, withExecutiveSummary, withTopThreeNarration } from '@/lib/openrouter';
import { loadLiveSnapshot, serverProfile } from '@/lib/server/reporting/data';
import { sendReportEmail } from '@/lib/server/reporting/email';

// ============================================================================
// GET /api/cron/reports — automation engine entry point.
//
// Vercel Cron invokes this daily (see vercel.json) and automatically attaches
// `Authorization: Bearer <CRON_SECRET>`; the route verifies it and returns 401
// for anything else, so the endpoint is not publicly triggerable.
//
// Behavior:
//   ?kind=auto   (default) → daily report every run; weekly report when the
//                            UTC weekday matches REPORT_WEEKLY_DAY (default 1=Mon)
//   ?kind=daily / ?kind=weekly → force just that report (for manual testing)
//
// The 14 automation rules run against a live snapshot (Supabase tasks/projects/
// versions/evaluations + live GitHub repos + Vercel/Firebase deployments) using
// the exact same engine as the UI, then the report is emailed via Resend.
// ============================================================================

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Append the fired 14-rule alerts to a report body so they surface in the email. */
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
  const kind: 'auto' | 'daily' | 'weekly' =
    rawKind === 'daily' || rawKind === 'weekly' ? rawKind : 'auto';
  const weeklyDay = Number(process.env.REPORT_WEEKLY_DAY ?? 1);
  const todayUtc = new Date().getUTCDay();

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

  // 4. Skip email noise before any live source is wired up.
  if (totalData === 0) {
    return NextResponse.json({
      ok: true,
      note: 'No live data configured — skipping email. Wire Supabase/GitHub/Vercel env vars first.',
      ownerId,
      configured: snapshot.configured,
    });
  }

  const wantDaily = kind === 'auto' || kind === 'daily';
  const wantWeekly = kind === 'auto' ? todayUtc === weeklyDay : kind === 'weekly';
  const reports: Array<Record<string, unknown>> = [];

  // AI executive summary is an enhancement: when OpenRouter is unconfigured or
  // the call fails, summarizeReport / narrateTopThree return null and the email
  // body is sent unchanged (deterministic text + alerts). Both AI calls for a
  // report run in parallel so two slow calls can't eat the whole cron maxDuration
  // budget.
  const pending: Array<{
    r: { title: string; body: string; attentionCount: number };
    kind: 'daily' | 'weekly';
  }> = [];
  if (wantDaily) pending.push({ r: buildDailyReportBody(state), kind: 'daily' });
  if (wantWeekly) pending.push({ r: buildWeeklyReportBody(state), kind: 'weekly' });

  // Deterministic top three, computed once — the same actions the dashboard
  // shows — so the AI narration in the email matches the UI briefing. The
  // narration, like the executive summary, uses the OPENROUTER_MODEL env default
  // (the per-user Settings picker applies to the UI only), keeping the two AI
  // sections of the emailed report consistent with each other.
  const topThree = wantDaily ? buildTopThree(state) : [];
  // Pass the same project identity the dashboard briefing uses (cite-backs),
  // resolving names from the snapshot so the emailed narration can be as
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

  const summarized = await Promise.all(
    pending.map(async ({ r, kind }) => {
      const [ai, narration] = await Promise.all([
        summarizeReport({ kind, title: r.title, body: r.body, attentionCount: r.attentionCount }),
        // The 'why these three matter today' briefing is a daily feature; weekly
        // reports keep the executive summary only.
        kind === 'daily'
          ? narrateTopThree({ actions: topThreeActions })
          : Promise.resolve(null),
      ]);
      let body = withExecutiveSummary(withAlertsSection(r.body, alerts), ai?.summary ?? null, ai?.model ?? null);
      if (kind === 'daily') {
        body = withTopThreeNarration(body, narration?.paragraph ?? null, narration?.model ?? null);
      }
      return {
        kind,
        title: r.title,
        attentionCount: r.attentionCount,
        body,
        model: ai?.model ?? null,
        narrationModel: narration?.model ?? null,
      };
    }),
  );

  for (const s of summarized) {
    const email = await sendReportEmail({
      kind: s.kind, title: s.title,
      body: s.body,
      attentionCount: s.attentionCount, alerts,
    });
    reports.push({ kind: s.kind, title: s.title, attentionCount: s.attentionCount, email, aiModel: s.model, narrationModel: s.narrationModel });
  }

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
    reports,
  });
}
