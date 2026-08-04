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
      id: 'e2e-user', name: 'E2E', email: 'e2e@local', timezone: 'UTC',
      dailyReportEnabled: true, dailyReportTime: '07:00',
      weeklyReportEnabled: true, weeklyReportDay: 1, weeklyReportTime: '07:00',
      defaultStaleDays: 7, ...profileOverride,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    },
    projects: [], versions: [], repositories: [], deployments: [], tasks: [], evaluations: [], activity: [],
    reports: savedReports,
    saveReport: async (r: Report) => { savedReports.unshift(r); },
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
// mount; route that to an empty feed so the AI stubs below only ever see
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
  vi.clearAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

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
    // The exact emailed body (incl. the Local scan freshness section) is previewed.
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

  it('discards a generated preview without saving', async () => {
    queue = [{ ok: true, configured: true, summary: 'Discard me.', model: 'deepseek/deepseek-chat' }];
    render(<ReportsPage />);

    await generateDaily();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(savedReports).toHaveLength(0);
  });
});

// ─── Preview body toggle per saved report ───────────────────────────────────

describe('ReportsPage — Preview body toggle', () => {
  it('re-opens the exact emailed body of a saved report via its Preview body button', async () => {
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
