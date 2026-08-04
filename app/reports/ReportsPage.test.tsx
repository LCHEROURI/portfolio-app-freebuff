import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReportsPage from './page';
import type { Report } from '@/types';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// The page only needs a store facade; stub it instead of mounting StoreProvider
// (which would load Firestore/demo data). saveReport pushes into a shared array
// so the rendered report list updates after a generate, mirroring the real store.
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

const stubSummarizeFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ReportsPage — AI executive summary', () => {
  it('saves the report with the AI summary and renders the callout with the model', async () => {
    queue = [{ ok: true, configured: true, summary: 'Push the unpushed commits first.', model: 'deepseek/deepseek-chat' }];
    render(<ReportsPage />);

    fireEvent.click(screen.getByRole('button', { name: /Generate Daily/i }));

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

    fireEvent.click(screen.getByRole('button', { name: /Generate Daily/i }));

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
    fireEvent.click(screen.getByRole('button', { name: /Generate Daily/i }));
    await waitFor(() => expect(lastRequestModel).toBe('anthropic/claude-3.5-sonnet'));
    // The returned model is what gets saved onto the report.
    const saved = savedReports.find((x) => x.kind === 'daily');
    expect(saved?.aiModel).toBe('anthropic/claude-3.5-sonnet');
  });

  it('falls back to the deterministic body when the summarize call fails', async () => {
    queue = [];
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    render(<ReportsPage />);

    fireEvent.click(screen.getByRole('button', { name: /Generate Daily/i }));

    const saved = await waitFor(() => {
      const r = savedReports.find((x) => x.kind === 'daily');
      expect(r).toBeDefined();
      return r!;
    });
    expect(saved.aiSummary).toBeUndefined();
    expect(saved.body).toContain('Daily Command Center Report');
    expect(screen.queryByText('AI executive summary')).toBeNull();
  });
});
