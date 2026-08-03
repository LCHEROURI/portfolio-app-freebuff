import { renderReportHtml } from '@/lib/server/reporting/html';
import type { AutomationAlert } from '@/lib/engine';

// ============================================================================
// Report email client — Resend REST API via fetch (no SDK, matching the
// project's PostgREST-over-fetch convention). Config is all env-driven:
//   RESEND_API_KEY   → required to send
//   REPORT_EMAIL     → recipient inbox
//   REPORT_FROM      → optional sender (default Command Center <onboarding@resend.dev>)
// ============================================================================

export interface ReportEmailInput {
  kind: 'daily' | 'weekly';
  title: string;
  body: string;
  attentionCount: number;
  alerts: AutomationAlert[];
}

export interface EmailResult {
  sent: boolean;
  emailId?: string;
  reason?: string;
}

const RESEND_URL = 'https://api.resend.com/emails';

export const sendReportEmail = async (input: ReportEmailInput): Promise<EmailResult> => {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.REPORT_EMAIL;
  if (!apiKey || !to) {
    return { sent: false, reason: !apiKey ? 'RESEND_API_KEY not set' : 'REPORT_EMAIL not set' };
  }

  const from = process.env.REPORT_FROM ?? 'Command Center <onboarding@resend.dev>';
  const html = renderReportHtml(input.title, input.body);

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: input.title, html, text: input.body }),
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) {
      return { sent: false, reason: data?.message ?? `Resend error ${res.status}` };
    }
    return { sent: true, emailId: data?.id };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : 'Resend request failed' };
  }
};
