import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';
import { sendReportEmail } from '@/lib/server/reporting/email';
import { getRequestUserId } from '@/lib/server/user';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// The route resolves identity via getRequestUserId and delivers via the same
// Resend client the cron uses; both are stubbed so the test is hermetic.
vi.mock('@/lib/server/user', () => ({
  getRequestUserId: vi.fn(async () => 'e2e-user'),
}));

vi.mock('@/lib/server/reporting/email', () => ({
  sendReportEmail: vi.fn(async () => ({ sent: true, emailId: 'email-1' })),
}));

const makeReq = (body: unknown, userId: string | null = 'e2e-user') => {
  vi.mocked(getRequestUserId).mockResolvedValue(userId);
  return new NextRequest('http://localhost/api/reports/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-user': 'e2e-user' },
    body: JSON.stringify(body),
  });
};

beforeEach(() => {
  vi.mocked(sendReportEmail).mockClear();
  vi.mocked(getRequestUserId).mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/reports/send', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const req = await makeReq({ kind: 'daily', title: 'T', body: 'B' }, null);
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false });
    expect(sendReportEmail).not.toHaveBeenCalled();
  });

  it('rejects a missing title/body with 400', async () => {
    const res = await POST(await makeReq({ kind: 'daily', title: '', body: 'B' }));
    expect(res.status).toBe(400);
    expect(sendReportEmail).not.toHaveBeenCalled();
  });

  it('composes the executive summary into the sent body exactly like the cron', async () => {
    const res = await POST(await makeReq({
      kind: 'daily',
      title: 'Daily Report 8/4/2026',
      body: '# Daily Command Center Report\n\n## Local scan freshness\n- Newest: fresh\n',
      attentionCount: 3,
      aiSummary: 'Push the unpushed commits first.',
      aiModel: 'deepseek/deepseek-chat',
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sent: true, emailId: 'email-1' });

    const sent = vi.mocked(sendReportEmail).mock.calls[0][0];
    expect(sent.kind).toBe('daily');
    expect(sent.attentionCount).toBe(3);
    // Friendly label in the heading, raw id in the footer — matching the cron.
    expect(sent.body).toContain('## ✨ AI executive summary (DeepSeek Chat)');
    expect(sent.body).toContain('Push the unpushed commits first.');
    expect(sent.body).toContain('Model: `deepseek/deepseek-chat`');
    // The deterministic body (incl. freshness section) rides below the summary.
    expect(sent.body).toContain('## Local scan freshness');
  });

  it('sends the body unchanged when there is no AI summary', async () => {
    const res = await POST(await makeReq({
      kind: 'weekly',
      title: 'Weekly Report',
      body: '# Weekly Command Center Report',
      attentionCount: 0,
    }));

    expect(res.status).toBe(200);
    const sent = vi.mocked(sendReportEmail).mock.calls[0][0];
    expect(sent.body).toBe('# Weekly Command Center Report');
    expect(sent.body).not.toContain('AI executive summary');
  });

  it('surfaces a skipped send gracefully instead of throwing', async () => {
    vi.mocked(sendReportEmail).mockResolvedValue({
      sent: false,
      reason: 'RESEND_API_KEY not set',
    });

    const res = await POST(await makeReq({ kind: 'daily', title: 'T', body: 'B', attentionCount: 0 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sent: false, reason: 'RESEND_API_KEY not set' });
  });
});
