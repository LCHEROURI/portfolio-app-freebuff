import { NextResponse, type NextRequest } from 'next/server';

import { withExecutiveSummary } from '@/lib/openrouter';
import { getRequestUserId } from '@/lib/server/user';
import { sendReportEmail } from '@/lib/server/reporting/email';

// ============================================================================
// POST /api/reports/send — user-facing "email this report now".
//
// The scheduled cron (/api/cron/reports) is gated by CRON_SECRET, which the
// browser can never hold. This route gives the Reports page's "Save and email
// now" button a way to trigger a manual delivery using the SAME Resend client
// the cron uses — the only difference is the identity check (verified Firebase
// ID token, or the demo x-app-user header) instead of the cron secret, and the
// body arrives pre-composed from the preview modal.
//
// Auth: matches every other live-data route via getRequestUserId.
// Graceful: sendReportEmail returns { sent: false, reason } when RESEND_API_KEY
// or REPORT_EMAIL is unset, and the route surfaces that instead of throwing, so
// the preview modal can show "saved, email skipped" rather than a hard error.
// ============================================================================

export const dynamic = 'force-dynamic';

export interface SendReportNowBody {
  kind: 'daily' | 'weekly';
  title: string;
  body: string;
  attentionCount: number;
  /** AI executive summary text (optional — prepended like the cron does). */
  aiSummary?: string | null;
  /** Model id that wrote the summary (for the friendly heading + raw footer). */
  aiModel?: string | null;
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  }

  let input: SendReportNowBody;
  try {
    input = (await req.json()) as SendReportNowBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (input.kind !== 'daily' && input.kind !== 'weekly') {
    return NextResponse.json({ ok: false, error: 'kind must be daily or weekly.' }, { status: 400 });
  }
  if (!input.title?.trim() || !input.body?.trim()) {
    return NextResponse.json({ ok: false, error: 'title and body are required.' }, { status: 400 });
  }

  // Compose exactly like the cron: the AI executive summary (friendly heading +
  // raw model footer) is prepended when present, otherwise the body is sent
  // unchanged. This mirrors what withExecutiveSummary does in the cron route.
  const body = withExecutiveSummary(
    input.body,
    input.aiSummary ?? null,
    input.aiModel ?? null,
  );

  const email = await sendReportEmail({
    kind: input.kind,
    title: input.title,
    body,
    attentionCount: input.attentionCount ?? 0,
    alerts: [],
  });

  return NextResponse.json({
    ok: true,
    sent: email.sent,
    emailId: email.emailId ?? null,
    reason: email.reason ?? null,
  });
}
