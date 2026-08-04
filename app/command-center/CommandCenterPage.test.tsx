import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CommandCenterPage from './page';
import type { Project, Task } from '@/types';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// The page only needs a store facade; stub it instead of mounting StoreProvider.
// The store shape must satisfy the pure engine builders (computeMetrics,
// buildPriorityQueue, buildTopThree, runAutomationRules) — an overdue task is
// enough to produce a non-empty Top Three.
const overdueTask: Task = {
  id: 't-1', userId: 'e2e-user', projectId: 'p-1', title: 'Ship onboarding',
  description: 'Finish the signup flow.', status: 'NEXT', priority: 'P1_HIGH',
  taskType: 'FEATURE', dueDate: '2020-01-01', position: 0,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
};

const project: Project = {
  id: 'p-1', userId: 'e2e-user', name: 'Weeknight Meal Planner', slug: 'weeknight-meal-planner',
  description: '', category: '', businessGoal: '', targetCustomer: '', monetizationModel: '',
  priority: 'P1_HIGH', overallStatus: 'TESTING', overallProgress: 60,
  nextAction: 'Ship', archived: false,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), lastActivityAt: new Date(0).toISOString(),
};

let profileOverride: { aiModel?: string } = {};

vi.mock('@/lib/store', () => ({
  useStore: () => ({
    userId: 'e2e-user',
    mode: 'demo',
    profile: {
      id: 'e2e-user', name: 'E2E', email: 'e2e@local', timezone: 'UTC',
      dailyReportEnabled: true, dailyReportTime: '07:00',
      weeklyReportEnabled: true, weeklyReportDay: 1, weeklyReportTime: '07:00',
      defaultStaleDays: 7, ...profileOverride,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    },
    projects: [project],
    versions: [],
    repositories: [],
    deployments: [],
    tasks: [overdueTask],
    reminders: [],
    evaluations: [],
    activity: [],
    reports: [],
  }),
}));

vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: () => false,
}));

// ─── Fetch stub: one queued /api/ai/top-three body per call ─────────────────

type NarrationBody = {
  ok: boolean;
  configured: boolean;
  narration: { paragraph: string; model: string } | null;
};

let queue: NarrationBody[];
let lastRequestModel: string | undefined;

const stubNarrationFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes('/api/ai/top-three')) {
      throw new Error(`Unexpected fetch in command-center test: ${url}`);
    }
    lastRequestModel = (JSON.parse(String(init?.body)) as { model?: string }).model;
    const body = queue.shift();
    if (!body) {
      throw new Error('Unexpected /api/ai/top-three call: response queue exhausted');
    }
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

beforeEach(() => {
  queue = [];
  lastRequestModel = undefined;
  profileOverride = {};
  stubNarrationFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('CommandCenterPage — AI top-three narration', () => {
  it('shows the AI Explain button when there are actions and narrates them on click', async () => {
    queue = [{
      ok: true, configured: true,
      narration: {
        paragraph: 'The failing production deploy is the priority today: fix it first, then push the unpushed work and close the overdue onboarding task.',
        model: 'deepseek/deepseek-chat',
      },
    }];
    render(<CommandCenterPage />);

    const button = screen.getByRole('button', { name: "Explain today's top three with AI" });
    fireEvent.click(button);

    // The narration card appears with the model badge inside the Top Three card.
    expect(await screen.findByText('Why these three matter today')).toBeInTheDocument();
    expect(screen.getByText('deepseek/deepseek-chat')).toBeInTheDocument();
    expect(screen.getByText(/failing production deploy is the priority today/)).toBeInTheDocument();

    // The rule-based list is still rendered underneath.
    const card = screen.getByRole('heading', { name: "Today's Top Three" }).closest('div.card-base');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText(/Ship onboarding/)).toBeInTheDocument();
  });

  it('shows the Thinking… state and disables the button while the call is in flight', async () => {
    queue = [{
      ok: true, configured: true,
      narration: { paragraph: 'Fix the deploy first.', model: 'deepseek/deepseek-chat' },
    }];
    // Resolve the narration call on a timer so the in-flight state is observable.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('/api/ai/top-three')) throw new Error(`Unexpected fetch: ${url}`);
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true, status: 200, json: async () => queue[0] } as Response;
    }));
    render(<CommandCenterPage />);

    const button = screen.getByRole('button', { name: "Explain today's top three with AI" });
    fireEvent.click(button);

    // The button keeps its aria-label as the accessible name; the label text
    // flips to 'Thinking…' and the button disables while the call is in flight.
    expect(button).toBeDisabled();
    expect(within(button).getByText('Thinking…')).toBeInTheDocument();

    await screen.findByText('Why these three matter today');
    expect(screen.getByText('deepseek/deepseek-chat')).toBeInTheDocument();
  });

  it('sends the per-user OpenRouter model preference with the request', async () => {
    profileOverride = { aiModel: 'anthropic/claude-3.5-sonnet' };
    queue = [{
      ok: true, configured: true,
      narration: { paragraph: 'Fix the deploy first.', model: 'anthropic/claude-3.5-sonnet' },
    }];
    render(<CommandCenterPage />);

    fireEvent.click(screen.getByRole('button', { name: "Explain today's top three with AI" }));

    await waitFor(() => expect(lastRequestModel).toBe('anthropic/claude-3.5-sonnet'));
  });

  it('falls back to the rule-based list when OpenRouter is unconfigured (narration null)', async () => {
    queue = [{ ok: true, configured: false, narration: null }];
    render(<CommandCenterPage />);

    fireEvent.click(screen.getByRole('button', { name: "Explain today's top three with AI" }));

    // No narration card; the deterministic list stays. 'Ship onboarding'
    // appears in the queue, the Top Three, and the alerts list, so use AllBy.
    expect(screen.queryByText('Why these three matter today')).toBeNull();
    await waitFor(() => expect(screen.getAllByText(/Ship onboarding/).length).toBeGreaterThanOrEqual(2));
  });

  it('falls back when the narration call fails outright', async () => {
    queue = [];
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    render(<CommandCenterPage />);

    fireEvent.click(screen.getByRole('button', { name: "Explain today's top three with AI" }));

    expect(screen.queryByText('Why these three matter today')).toBeNull();
    await waitFor(() => expect(screen.getAllByText(/Ship onboarding/).length).toBeGreaterThanOrEqual(2));
  });
});
