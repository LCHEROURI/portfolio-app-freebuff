import { NextResponse, type NextRequest } from 'next/server';

import {
  buildDailyReportBody, buildTopThree, buildWeeklyReportBody, runAutomationRules,
  type AppState, type AutomationAlert,
} from '@/lib/engine';
import { narrateTopThree, summarizeReport, withExecutiveSummary, withTopThreeNarration } from '@/lib/openrouter';
import type { ReportPreviewPayload } from '@/lib/reportPreview';
import { loadLiveSnapshot, serverProfile } from '@/lib/server/reporting/data';
import { sendReportEmail } from '@/lib/server/reporting/email';
import { toActivityRow } from '@/lib/server/rows';
import { isSupabaseConfigured, supabaseUpsert } from '@/lib/server/supabase';

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
//   ?previewBody=1 → dev-only: include each report's composed email body in the
//                    JSON response (still requires the CRON_SECRET bearer), so
//                    the exact emailed text can be verified without opening an
//                    inbox. Omitted by default to keep the response lean.
//   ?previewBody=1&format=text → dev-only plain-text email preview: returns the
//                    composed body as text/plain and does NOT send the email,
//                    so the exact text can be piped into a mail client or file
//                    without touching the real inbox or waiting for the
//                    scheduled cron. (A manual trigger WITHOUT format=text
//                    still delivers to REPORT_EMAIL immediately — that is the
//                    "check it in a real inbox" path.)
//   ?sendTest=1 → send via Resend test/sandbox mode: uses RESEND_TEST_API_KEY
//                    (falling back to RESEND_API_KEY) and the sandbox recipient
//                    instead of REPORT_EMAIL, so a generated report lands in the
//                    Resend test inbox without configuring a real inbox. The
//                    per-report email object in the response carries the test
//                    emailId.
//
// Every send (real or test) also logs a `report_generated` activity row to the
// Supabase activity table when Supabase is configured, so the Activity page
// shows the full delivery history — cron sends, test sends, and the client's
// 'Save and email now' / retry all land in the same feed.
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
  // Dev-only verification aid: include the composed email body in the response.
  const previewBody = req.nextUrl.searchParams.get('previewBody') === '1';
  // Dev-only plain-text preview: when set, the composed body is returned as
  // text/plain and the email is NOT sent.
  const textPreview = previewBody && req.nextUrl.searchParams.get('format') === 'text';
  // Dev-only test-mode send: deliver to the Resend sandbox instead of the real
  // inbox so a generated report can be checked in the Resend test inbox without
  // configuring REPORT_EMAIL.
  const sendTest = req.nextUrl.searchParams.get('sendTest') === '1';
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
  // Each report entry carries the shared preview payload (kind/title/body/
  // attentionCount/aiModel/narration) so the ?previewBody=1 response and the
  // Reports page preview modal agree on structure by construction.
  const reports: Array<ReportPreviewPayload & {
    email: { sent: boolean; emailId?: string; reason?: string };
    narrationModel: string | null;
  }> = [];

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
        // Structured narration (daily only) so verifiers can assert the exact
        // paragraph and model without parsing the composed body text.
        narration,
      };
    }),
  );

  for (const s of summarized) {
    // Plain-text preview skips delivery entirely (no inbox write, no wait); the
    // default path always sends like the scheduled cron does; sendTest delivers
    // to the Resend sandbox.
    const email = textPreview
      ? { sent: false, reason: 'text preview — email not sent' }
      : await sendReportEmail(
          {
            kind: s.kind, title: s.title,
            body: s.body,
            attentionCount: s.attentionCount, alerts,
          },
          { test: sendTest },
        );
    reports.push({
      kind: s.kind, title: s.title, attentionCount: s.attentionCount, email,
      aiModel: s.model, narrationModel: s.narration?.model ?? null,
      // The full preview payload (body + structured narration) rides along so
      // the shared ReportPreviewPayload type is always satisfied; the response
      // below strips the heavy fields unless ?previewBody=1 asks for them.
      body: s.body,
      narration: s.narration,
    });

    // Log a report_generated activity row (Supabase) so the Activity page shows
    // the delivery history. Best-effort: never fail the cron on a log write.
    if (isSupabaseConfigured()) {
      try {
        await supabaseUpsert('activity', toActivityRow({
          id: `a-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          userId: ownerId,
          kind: 'report_generated',
          message: email.sent
            ? `${s.kind} report "${s.title}" emailed (${email.emailId ?? 'no id'})${sendTest ? ' [test]' : ''}`
            : `${s.kind} report "${s.title}" email ${email.reason ?? 'not sent'}`,
          createdAt: new Date().toISOString(),
        }));
      } catch (e) {
        console.warn('activity log skipped (cron):', e instanceof Error ? e.message : e);
      }
    }
  }

  // Dev-only plain-text email preview: serve the composed body as text/plain
  // instead of JSON, and never send it — the exact emailed text is now
  // curl-able / pipe-able without waiting for the schedule.
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
        aiModel: r.aiModel, narrationModel: r.narrationModel, email: r.email,
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
