import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the server helpers the route depends on (same pattern as the scans
// route test): identity resolution and the Chrome PDF renderer. The renderer
// is mocked so the route's HTTP contract is testable without spawning Chrome.
const { getRequestUserIdMock, renderHtmlToPdfMock } = vi.hoisted(() => ({
  getRequestUserIdMock: vi.fn().mockResolvedValue('demo-user'),
  renderHtmlToPdfMock: vi.fn(),
}));
vi.mock('@/lib/server/user', () => ({
  getRequestUserId: getRequestUserIdMock,
}));
vi.mock('@/lib/server/chromePdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/chromePdf')>();
  return {
    ...actual,
    renderHtmlToPdf: renderHtmlToPdfMock,
  };
});

import { POST } from './route';

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/print/pdf', {
    method: 'POST',
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  // The 401 test replaces this mock's implementation with null; restore the
  // default every test so later tests don't inherit a null identity.
  getRequestUserIdMock.mockResolvedValue('demo-user');
});

describe('POST /api/print/pdf', () => {
  it('returns a PDF attachment for a valid document', async () => {
    renderHtmlToPdfMock.mockResolvedValue(Buffer.from('%PDF-1.4 fake pdf bytes'));
    const res = await POST(makeRequest({
      title: 'Daily Command Center Report — 8/4/2026',
      meta: 'daily report · 3 attention items',
      body: '# Daily\n## Local scan freshness',
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="daily-command-center-report-8-4-2026.pdf"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toBe('%PDF-1.4 fake pdf bytes');
  });

  it('builds the document with the shared buildPreviewHtml (no drift from the preview)', async () => {
    renderHtmlToPdfMock.mockResolvedValue(Buffer.from('%PDF'));
    await POST(makeRequest({ title: 'Daily', body: '# body' }));
    const html = renderHtmlToPdfMock.mock.calls[0][0] as string;
    expect(html).toContain('<title>Daily</title>');
    expect(html).toContain('<pre># body</pre>');
  });

  it('rejects an unauthenticated request with 401', async () => {
    getRequestUserIdMock.mockResolvedValue(null);
    const res = await POST(makeRequest({ title: 'x', body: '# x' }));
    expect(res.status).toBe(401);
    expect(renderHtmlToPdfMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid body with 400', async () => {
    const res = await POST(makeRequest({ body: '# missing title' }));
    expect(res.status).toBe(400);
    expect(renderHtmlToPdfMock).not.toHaveBeenCalled();
  });

  it('returns 503 with the targeted message when headless Chrome is unavailable', async () => {
    renderHtmlToPdfMock.mockRejectedValue(
      new (await import('@/lib/server/chromePdf')).ChromePdfUnavailableError('Headless Chrome not available here.'),
    );
    const res = await POST(makeRequest({ title: 'x', body: '# x' }));
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('Headless Chrome not available here.');
  });

  it('returns 500 for any other render failure', async () => {
    renderHtmlToPdfMock.mockRejectedValue(new Error('CDP websocket exploded'));
    const res = await POST(makeRequest({ title: 'x', body: '# x' }));
    expect(res.status).toBe(500);
  });
});
