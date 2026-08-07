import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReportsPage from './page';
import type { Report } from '@/types';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// The page only needs a store facade; stub it instead of mounting StoreProvider
// (which would load Firestore/demo data). saveReport pushes into a shared array
// so the rendered report list updates after a save, mirroring the real store.
// `profileOverride` lets a test simulate a saved per-user AI model preference.
// NOTE: this `let` is read inside the vi.mock factory below. Vitest hoists the
// mock but defers factory execution until the store module is first imported
// (at first render, inside a test), so reading the variable is safe. Keep the
// declaration above the mock and never import '@/lib/store' eagerly in tests.
const savedReports: Report[] = [];
let profileOverride: { aiModel?: string } = {};

vi.mock('@/lib/store', () => ({
  useStore: () => ({
    userId: 'e2e-user',
    profile: {
      id: 'e2e-user', name: 'E2E', timezone: 'UTC',
      dailyReportEnabled: true, dailyReportTime: '07:00',
      weeklyReportEnabled: true, weeklyReportDay: 1, weeklyReportTime: '07:00',
      defaultStaleDays: 7, ...profileOverride,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    },
    projects: [], versions: [], repositories: [], deployments: [], tasks: [], evaluations: [], activity: [],
    reports: savedReports,
    saveReport: async (r: Report) => {
      const i = savedReports.findIndex((x) => x.id === r.id);
      if (i >= 0) savedReports[i] = r;
      else savedReports.unshift(r);
    },
  }),
}));

// The page never touches Firebase directly, but fetchAiSummary → liveData →
// getAuthToken imports @/lib/firebase. Stub the module to keep the SDK import
// chain out of the test entirely.
vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: () => false,
  readFirebaseConfig: () => null,
  getFirebaseApp: () => null,
  getFirebaseAuth: () => null,
  getFirestoreDb: () => null,
  getFirebaseFunctions: () => null,
  getUserId: async () => 'e2e-user',
  subscribeToUser: () => () => {},
}));

// ─── Fetch stub: one queued /api/ai/summarize body per generate ─────────────

type SummaryBody = { ok: boolean; configured: boolean; summary: string | null; model: string | null };

let queue: SummaryBody[];
let lastRequestModel: string | undefined;

// The page also mounts the LastScanStrip, which fetches GET /api/scans on
// mount; route that to an empty feed so the AI stub below only ever sees
// /api/ai/summarize calls.
const stubSummarizeFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/scans')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, repos: [] }) } as Response;
    }
    if (!url.includes('/api/ai/summarize')) {
      throw new Error(`Unexpected fetch in reports test: ${url}`);
    }
    lastRequestModel = (JSON.parse(String(init?.body)) as { model?: string }).model;
    const body = queue.shift();
    if (!body) {
      throw new Error('Unexpected /api/ai/summarize call: response queue exhausted');
    }
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

beforeEach(() => {
  savedReports.length = 0;
  queue = [];
  lastRequestModel = undefined;
  profileOverride = {};
  stubSummarizeFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

// A fake window.open() return value: a minimal window whose document spies
// capture the standalone HTML the preview flow writes.
const fakePreviewWindow = () => {
  const write = vi.fn();
  const win = {
    document: { open: vi.fn(), write, close: vi.fn() },
    focus: vi.fn(),
  } as unknown as Window;
  return { win, write };
};

// Generating now opens a preview modal instead of saving immediately, so tests
// confirm the preview first, then click Save to persist.
const generateDaily = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Generate Daily/i }));
  await screen.findByRole('dialog');
};

const saveFromPreview = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ReportsPage — AI executive summary', () => {
  it('previews the report with the AI summary, then saves it on Save and renders the callout with the model', async () => {
    queue = [{ ok: true, configured: true, summary: 'Push the unpushed commits first.', model: 'deepseek/deepseek-chat' }];
    render(<ReportsPage />);

    await generateDaily();

    // The preview modal shows the AI summary callout with the model before saving.
    expect(within(screen.getByRole('dialog')).getByText('AI executive summary')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('DeepSeek Chat')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Push the unpushed commits first.')).toBeInTheDocument();
    // The exact report body (incl. the Local scan freshness section) is previewed.
    expect(within(screen.getByRole('dialog')).getByText(/## Local scan freshness/)).toBeInTheDocument();

    // Nothing is saved until the user confirms.
    expect(savedReports).toHaveLength(0);

    await saveFromPreview();

    const saved = await waitFor(() => {
      const r = savedReports.find((x) => x.kind === 'daily');
      expect(r).toBeDefined();
      return r!;
    });
    expect(saved.aiSummary).toBe('Push the unpushed commits first.');
    expect(saved.aiModel).toBe('deepseek/deepseek-chat');

    // The callout renders inside the saved report's <details>.
    const details = (await screen.findByText(/Daily Report/)).closest('details');
    expect(details).not.toBeNull();
    const d = details as HTMLElement;
    expect(within(d).getByText('AI executive summary')).toBeInTheDocument();
    expect(within(d).getByText('DeepSeek Chat')).toBeInTheDocument();
    expect(within(d).getByText('Push the unpushed commits first.')).toBeInTheDocument();
  });

  it('falls back to the deterministic body when OpenRouter is unconfigured (summary null)', async () => {
    queue = [{ ok: true, configured: false, summary: null, model: null }];
    render(<ReportsPage />);

    await generateDaily();

    // The preview opens without an AI callout.
    expect(within(screen.getByRole('dialog')).queryByText('AI executive summary')).toBeNull();
    expect(within(screen.getByRole('dialog')).getByText(/Daily Command Center Report/)).toBeInTheDocument();

    await saveFromPreview();

    const saved = await waitFor(() => {
      const r = savedReports.find((x) => x.kind === 'daily');
      expect(r).toBeDefined();
      return r!;
    });
    expect(saved.aiSummary).toBeUndefined();
    expect(saved.body).toContain('Daily Command Center Report');
    expect(screen.queryByText('AI executive summary')).toBeNull();
  });

  it('sends the per-user OpenRouter model preference (Settings → AI summaries) with the request', async () => {
    queue = [{ ok: true, configured: true, summary: 'Claude summary.', model: 'anthropic/claude-3.5-sonnet' }];
    profileOverride = { aiModel: 'anthropic/claude-3.5-sonnet' };
    render(<ReportsPage />);
    await generateDaily();
    await waitFor(() => expect(lastRequestModel).toBe('anthropic/claude-3.5-sonnet'));
    await saveFromPreview();
    const saved = savedReports.find((x) => x.kind === 'daily');
    expect(saved?.aiModel).toBe('anthropic/claude-3.5-sonnet');
  });

  it('falls back to the deterministic body when the summarize call fails', async () => {
    queue = [];
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    render(<ReportsPage />);

    await generateDaily();

    // The preview still opens with the deterministic body, no AI callout.
    expect(within(screen.getByRole('dialog')).queryByText('AI executive summary')).toBeNull();
    expect(within(screen.getByRole('dialog')).getByText(/Daily Command Center Report/)).toBeInTheDocument();

    await saveFromPreview();

    const saved = await waitFor(() => {
      const r = savedReports.find((x) => x.kind === 'daily');
      expect(r).toBeDefined();
      return r!;
    });
    expect(saved.aiSummary).toBeUndefined();
    expect(saved.body).toContain('Daily Command Center Report');
    expect(screen.queryByText('AI executive summary')).toBeNull();
  });

  it('asks once before discarding a generated (unsaved) preview', async () => {
    queue = [{ ok: true, configured: true, summary: 'Discard me.', model: 'deepseek/deepseek-chat' }];
    render(<ReportsPage />);

    await generateDaily();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // First Discard click: nothing closes, a confirm banner appears instead.
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText("Discard this generated report? It hasn't been saved.")).toBeInTheDocument();
    expect(savedReports).toHaveLength(0);

    // 'Keep editing' cancels and stays in the preview.
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText("Discard this generated report? It hasn't been saved.")).toBeNull();

    // Second Discard click re-arms the confirm; the explicit red button throws it away.
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard report' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(savedReports).toHaveLength(0);
  });
});

// ─── Preview body toggle per saved report ───────────────────────────────────

describe('ReportsPage — Preview body toggle', () => {
  it('re-opens the exact report body of a saved report via its Preview body button', async () => {
    savedReports.push({
      id: 'r-saved',
      userId: 'e2e-user',
      kind: 'daily',
      title: 'Daily Report 8/4/2026',
      body: '# Daily Command Center Report — 8/4/2026\n\n## Local scan freshness\n- Newest: **LCHEROURI/new-repo** — scanned 1h ago\n',
      attentionCount: 3,
      createdAt: new Date().toISOString(),
      aiSummary: 'A saved summary.',
      aiModel: 'deepseek/deepseek-chat',
    });
    render(<ReportsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Preview body of Daily Report 8/4/2026' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Preview daily report')).toBeInTheDocument();
    // Exact body incl. the freshness section, plus the saved AI summary.
    expect(within(dialog).getByText(/## Local scan freshness/)).toBeInTheDocument();
    expect(within(dialog).getByText('A saved summary.')).toBeInTheDocument();

    // Re-opening a saved report is view-only: Close, no Save.
    expect(within(dialog).queryByRole('button', { name: 'Save report' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(savedReports).toHaveLength(1); // nothing re-saved
  });
});

// ─── Print report ───────────────────────────────────────────────────────────

// Printing prefers a styled preview window (usePrint) and only falls back to
// the in-page .print-report recipe when the popup is blocked. These tests mock
// window.open to return null so the in-page fallback runs, then assert the
// print-only area rendered the exact body and window.print fired.
describe('ReportsPage — print report', () => {
  const blockPopup = () => vi.spyOn(window, 'open').mockReturnValue(null);

  it('prints the previewed report body from the modal Print report button', async () => {
    blockPopup();
    const printMock = vi.fn();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(printMock);
    queue = [{ ok: true, configured: false, summary: null, model: null }];
    render(<ReportsPage />);

    await generateDaily();

    // The modal offers Print report alongside Save.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Print report' }));

    // The print-only area mirrors the exact report body (title + freshness
    // section), and the dialog is invoked once.
    const printArea = screen.getByTestId('print-report');
    expect(within(printArea).getByText(/Daily Command Center Report/)).toBeInTheDocument();
    expect(within(printArea).getByText(/## Local scan freshness/)).toBeInTheDocument();
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));

    // The area is released after the dialog opens — nothing lingers on screen.
    await waitFor(() => expect(screen.queryByTestId('print-report')).toBeNull());
  });

  it('prints a saved report from its row, including the AI summary', async () => {
    blockPopup();
    const printMock = vi.fn();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(printMock);
    savedReports.push({
      id: 'r-print',
      userId: 'e2e-user',
      kind: 'weekly',
      title: 'Weekly Report 8/7/2026',
      body: '# Weekly Command Center Report\n\n## Model performance\n- DeepSeek Chat 9.2\n',
      attentionCount: 4,
      createdAt: new Date().toISOString(),
      aiSummary: 'Deploy the winner.',
      aiModel: 'deepseek/deepseek-chat',
    });
    render(<ReportsPage />);

    // Row-level Print on a saved report (does not toggle the <details>).
    fireEvent.click(screen.getByRole('button', { name: 'Print Weekly Report 8/7/2026' }));

    const printArea = screen.getByTestId('print-report');
    expect(within(printArea).getByText(/Weekly Command Center Report/)).toBeInTheDocument();
    expect(within(printArea).getByText('AI executive summary')).toBeInTheDocument();
    expect(within(printArea).getByText('Deploy the winner.')).toBeInTheDocument();
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('print-report')).toBeNull());
  });

  it('opens a styled preview window with the report when the popup is allowed', async () => {
    const { win, write } = fakePreviewWindow();
    vi.spyOn(window, 'open').mockReturnValue(win);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    queue = [{ ok: true, configured: false, summary: null, model: null }];
    render(<ReportsPage />);

    await generateDaily();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Print report' }));

    // The preview window received the standalone document with the report's
    // title and exact body; the browser dialog never opens directly and the
    // in-page recipe is not rendered.
    expect(write).toHaveBeenCalledTimes(1);
    const html = String(write.mock.calls[0][0]);
    expect(html).toContain('Daily Command Center Report');
    expect(html).toContain('## Local scan freshness');
    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('print-report')).toBeNull();
  });
});

// ─── Download PDF ────────────────────────────────────────────────────────────

// Downloading renders the SAME PrintDoc the preview shows through the shared
// /api/print/pdf route, then saves the returned blob. jsdom lacks
// URL.createObjectURL and blob: navigation, so a URL subclass stubs the two
// statics (inheriting the real URL for any `new URL(...)` call) and the anchor
// click is spied.
describe('ReportsPage — download PDF', () => {
  const stubPdfWindow = () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    class FakeURL extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal('URL', FakeURL as unknown as typeof URL);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    return { createObjectURL, revokeObjectURL, clickSpy };
  };

  it('downloads the previewed report as a PDF via the shared route', async () => {
    const { createObjectURL, clickSpy } = stubPdfWindow();
    let pdfBody: unknown;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/scans')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, repos: [] }) } as Response;
      }
      if (url.includes('/api/print/pdf')) {
        pdfBody = JSON.parse(String(init?.body));
        return {
          ok: true, status: 200,
          blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
        } as unknown as Response;
      }
      throw new Error(`Unexpected fetch in reports pdf test: ${url}`);
    }));
    queue = [{ ok: true, configured: false, summary: null, model: null }];
    render(<ReportsPage />);

    await generateDaily();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Download PDF' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    // The request carried the same PrintDoc the preview renders: a date-based
    // title plus the exact body (incl. the Local scan freshness section).
    expect((pdfBody as { title: string }).title).toMatch(/^Daily Report/);
    expect((pdfBody as { body: string }).body).toContain('Daily Command Center Report');
    expect((pdfBody as { body: string }).body).toContain('## Local scan freshness');
  });

  it('shows a targeted error when the PDF route is unavailable', async () => {
    stubPdfWindow();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/scans')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, repos: [] }) } as Response;
      }
      if (url.includes('/api/print/pdf')) {
        return {
          ok: false, status: 503,
          json: async () => ({ ok: false, error: 'Headless Chrome not available here.' }),
        } as Response;
      }
      throw new Error(`Unexpected fetch in reports pdf test: ${url}`);
    }));
    queue = [{ ok: true, configured: false, summary: null, model: null }];
    render(<ReportsPage />);

    await generateDaily();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Download PDF' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Headless Chrome not available here.');
  });

  it('downloads a saved report from its row', async () => {
    const { createObjectURL, clickSpy } = stubPdfWindow();
    let pdfBody: unknown;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/scans')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, repos: [] }) } as Response;
      }
      if (url.includes('/api/print/pdf')) {
        pdfBody = JSON.parse(String(init?.body));
        return {
          ok: true, status: 200,
          blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
        } as unknown as Response;
      }
      throw new Error(`Unexpected fetch in reports pdf test: ${url}`);
    }));
    savedReports.push({
      id: 'r-pdf',
      userId: 'e2e-user',
      kind: 'daily',
      title: 'Daily Report 8/7/2026',
      body: '# Daily Command Center Report\n\n## Local scan freshness\n- Newest: **LCHEROURI/new-repo** — scanned 1h ago\n',
      attentionCount: 2,
      createdAt: new Date().toISOString(),
    });
    render(<ReportsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF of Daily Report 8/7/2026' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect((pdfBody as { title: string }).title).toBe('Daily Report 8/7/2026');
  });
});

// ─── Local scan freshness preview ───────────────────────────────────────────

describe('ReportsPage — local scan freshness preview', () => {
  it('renders the scan freshness block before any report is generated', async () => {
    // The strip fetches GET /api/scans on mount; serve one fresh + one stale
    // repo so the newest/oldest rows and stale count are visible.
    const now = Date.now();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/scans')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            ok: true,
            repos: [
              {
                id: 'r-fresh', owner: 'LCHEROURI', repositoryName: 'fresh-repo',
                lastScannedAt: new Date(now - 3_600_000).toISOString(),
                hasUncommittedChanges: false, hasUnpushedCommits: false,
              },
              {
                id: 'r-stale', owner: 'LCHEROURI', repositoryName: 'stale-repo',
                lastScannedAt: new Date(now - 5 * 86_400_000).toISOString(),
                hasUncommittedChanges: false, hasUnpushedCommits: false,
              },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch in reports test: ${url}`);
    }));

    render(<ReportsPage />);

    // The strip labels itself 'Local scan' and lists newest → oldest repos,
    // with the shared freshness badges — visible before generating.
    expect(screen.getByText('Local scan')).toBeInTheDocument();
    expect(await screen.findByText('LCHEROURI/fresh-repo')).toBeInTheDocument();
    expect(screen.getByText('LCHEROURI/stale-repo')).toBeInTheDocument();
    expect(screen.getByText(/stale scan · 5d ago/)).toBeInTheDocument();
    expect(screen.getByText('1 stale')).toBeInTheDocument();
  });

  it('links the LOCAL SCAN heading to the Settings scan-schedule card', async () => {
    render(<ReportsPage />);

    const scheduleLink = screen.getByRole('link', { name: 'Schedule' });
    expect(scheduleLink).toHaveAttribute('href', '/settings#scan-schedule');
  });
});
