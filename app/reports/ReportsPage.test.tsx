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
// Activity entries logged by save-and-email-now / retry, captured so tests can
// assert the delivery history reaches the activity feed.
const loggedActivity: Array<{ kind: string; message: string }> = [];

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
    // Mirror the real store's upsert-by-id semantics: 'Save and email now'
    // saves the report once, then re-saves the SAME id with its delivery
    // status, so the mock must replace in place rather than duplicate.
    saveReport: async (r: Report) => {
      const i = savedReports.findIndex((x) => x.id === r.id);
      if (i >= 0) savedReports[i] = r;
      else savedReports.unshift(r);
    },
    logActivity: async (e: { kind: string; message: string }) => { loggedActivity.push(e); },
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

// /api/reports/send (Save and email now) responses, consumed in order.
let sendQueue: Array<{ sent: boolean; reason?: string | null }>;

// The page also mounts the LastScanStrip, which fetches GET /api/scans on
// mount; route that to an empty feed so the AI stubs below only ever see
// /api/ai/summarize and /api/reports/send calls.
const stubSummarizeFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/scans')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, repos: [] }) } as Response;
    }
    if (url.includes('/api/reports/send')) {
      const next = sendQueue.shift() ?? { sent: true };
      return {
        ok: true, status: 200,
        json: async () => ({ ok: true, ...next, emailId: next.sent ? 'email-1' : null }),
      } as Response;
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
  loggedActivity.length = 0;
  queue = [];
  lastRequestModel = undefined;
  sendQueue = [];
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

  it('saves and emails now, persists the delivery badge on the card, and flips the preview to view-only', async () => {
    queue = [{ ok: true, configured: true, summary: 'Send me.', model: 'deepseek/deepseek-chat' }];
    sendQueue = [{ sent: true }];
    render(<ReportsPage />);

    await generateDaily();

    fireEvent.click(screen.getByRole('button', { name: 'Save and email now' }));

    // One report row saved and delivered; the delivery outcome is persisted.
    const saved = await waitFor(() => {
      // The page saves the report FIRST (before the send) and then re-saves the
      // same id with the delivery status — wait for the status to be persisted.
      expect(savedReports).toHaveLength(1);
      expect(savedReports[0].emailStatus).toBeDefined();
      return savedReports[0];
    });
    expect(saved.aiSummary).toBe('Send me.');
    expect(saved.emailStatus).toBe('sent');
    expect(saved.emailId).toBe('email-1');
    expect(saved.emailAttemptedAt).toBeDefined();
    // The delivery lands in the activity feed with the emailId.
    expect(loggedActivity.some((a) => a.kind === 'report_generated' && a.message.includes('email-1'))).toBe(true);

    // The preview is now view-only (Close, no Save) so a second click can't duplicate.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Save report' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Save and email now' })).toBeNull();

    // Close the modal: the 'Emailed ✓' badge must SURVIVE on the saved card
    // (it renders from the persisted emailStatus, not the transient note).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Emailed ✓')).toBeInTheDocument();
    const badge = screen.getByText('Emailed ✓');
    expect(badge).toHaveAttribute('title', 'Resend email id: email-1');
    expect(savedReports).toHaveLength(1); // upsert, no duplicate
  });

  it('still saves when the send is skipped (email unconfigured) and persists the reason on the card', async () => {
    queue = [{ ok: true, configured: true, summary: 'Save anyway.', model: 'deepseek/deepseek-chat' }];
    sendQueue = [{ sent: false, reason: 'RESEND_API_KEY not set' }];
    render(<ReportsPage />);

    await generateDaily();
    fireEvent.click(screen.getByRole('button', { name: 'Save and email now' }));

    await waitFor(() => expect(savedReports).toHaveLength(1));
    expect(savedReports[0].emailStatus).toBe('skipped');
    expect(savedReports[0].emailReason).toBe('RESEND_API_KEY not set');
    expect(await screen.findByText(/Saved — email skipped: RESEND_API_KEY not set/)).toBeInTheDocument();
    // View-only after the attempt, so the report can't be double-saved.
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Save report' })).toBeNull();

    // Close the modal: the skip reason badge survives on the card.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(screen.getByText('Email skipped — RESEND_API_KEY not set')).toBeInTheDocument();
  });
});

// ─── Retry email on a saved card ─────────────────────────────────────────────

describe('ReportsPage — Retry email', () => {
  it('re-POSTs to /api/reports/send and flips a skipped card to Emailed ✓ in place', async () => {
    // A previously saved report that was skipped (email unconfigured at the time).
    savedReports.push({
      id: 'r-skipped',
      userId: 'e2e-user',
      kind: 'daily',
      title: 'Daily Report 8/4/2026',
      body: '# Daily Command Center Report',
      attentionCount: 3,
      createdAt: new Date().toISOString(),
      emailStatus: 'skipped',
      emailReason: 'RESEND_API_KEY not set',
    });
    // The retry send succeeds this time.
    sendQueue = [{ sent: true }];
    render(<ReportsPage />);

    const retryButton = screen.getByRole('button', { name: 'Retry email for Daily Report 8/4/2026' });
    fireEvent.click(retryButton);

    // The badge flips in place to Emailed ✓ with the emailId in the tooltip.
    const emailed = await screen.findByText('Emailed ✓');
    expect(emailed).toHaveAttribute('title', 'Resend email id: email-1');
    expect(savedReports[0].emailStatus).toBe('sent');
    expect(savedReports[0].emailId).toBe('email-1');
    // Still exactly one report (upsert, no duplicate) and a retry activity entry.
    expect(savedReports).toHaveLength(1);
    expect(loggedActivity.some((a) => a.kind === 'report_generated' && a.message.includes('retried') && a.message.includes('email-1'))).toBe(true);
  });

  it('keeps a failed card flagged when the retry also fails', async () => {
    savedReports.push({
      id: 'r-failed',
      userId: 'e2e-user',
      kind: 'weekly',
      title: 'Weekly Report',
      body: '# Weekly Command Center Report',
      attentionCount: 0,
      createdAt: new Date().toISOString(),
      emailStatus: 'failed',
      emailReason: 'Email delivery failed.',
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    render(<ReportsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry email for Weekly Report' }));

    // The card stays flagged failed with the retry timestamp refreshed.
    await waitFor(() => expect(savedReports[0].emailStatus).toBe('failed'));
    expect(savedReports[0].emailReason).toBe('Email delivery failed.');
    expect(savedReports[0].emailAttemptedAt).toBeDefined();
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
