import { renderReportHtml } from '@/lib/server/reporting/html';
import type { AutomationAlert } from '@/lib/engine';

// ============================================================================
// Report email client — Resend REST API via fetch (no SDK, matching the
// project's plain fetch-over-API convention). Config is all env-driven:
//   RESEND_API_KEY      → required to send
//   REPORT_EMAIL        → recipient inbox
//   REPORT_FROM         → optional sender (default Command Center <onboarding@resend.dev>)
//   RESEND_TEST_API_KEY → optional; when set, ?sendTest=1 sends go to the Resend
//                         test (sandbox) inbox instead of REPORT_EMAIL
// ============================================================================

export interface ReportEmailInput {
  kind: 'daily' | 'weekly';
  title: string;
  body: string;
  attentionCount: number;
  alerts: AutomationAlert[];
}

export interface ReportEmailOptions {
  /** Resend test/sandbox mode: sends with RESEND_TEST_API_KEY (falling back to
   *  RESEND_API_KEY) to the sandbox recipient, so a generated report lands in
   *  the Resend test inbox without configuring REPORT_EMAIL. Returns the test
   *  emailId so verifiers can assert the delivery. */
  test?: boolean;
}

export interface EmailResult {
  sent: boolean;
  emailId?: string;
  reason?: string;
}

const RESEND_URL = 'https://api.resend.com/emails';
// Resend sandbox recipient — test-mode emails appear in the Resend dashboard's
// test inbox regardless of the to-address, but this keeps the API call valid
// when REPORT_EMAIL isn't configured yet.
const TEST_RECIPIENT = 'delivered@resend.dev';

export const sendReportEmail = async (
  input: ReportEmailInput,
  opts: ReportEmailOptions = {},
): Promise<EmailResult> => {
  const apiKey = opts.test
    ? (process.env.RESEND_TEST_API_KEY ?? process.env.RESEND_API_KEY)
    : process.env.RESEND_API_KEY;
  const to = process.env.REPORT_EMAIL;
  if (!apiKey) {
    return { sent: false, reason: opts.test ? 'RESEND_TEST_API_KEY not set' : 'RESEND_API_KEY not set' };
  }
  if (!opts.test && !to) {
    return { sent: false, reason: 'REPORT_EMAIL not set' };
  }
  const recipient = opts.test ? TEST_RECIPIENT : to!;

  const from = process.env.REPORT_FROM ?? 'Command Center <onboarding@resend.dev>';
  const html = renderReportHtml(input.title, input.body);

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipient, subject: input.title, html, text: input.body }),
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
