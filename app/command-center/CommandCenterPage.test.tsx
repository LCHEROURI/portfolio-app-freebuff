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
// Simulates async store hydration: tests can start with no tasks, then flip
// this and re-render to mimic live data arriving after mount.
let tasksOverride: Task[] = [overdueTask];

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
    tasks: tasksOverride,
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
  narration: { paragraph: string; model: string; projectIds: string[] } | null;
};

let queue: NarrationBody[];
let lastRequestModel: string | undefined;
let lastFetchMock: ReturnType<typeof vi.fn> | undefined;

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
  lastFetchMock = undefined;
  profileOverride = {};
  tasksOverride = [overdueTask];
  delete process.env.NEXT_PUBLIC_ENABLE_AI_BRIEFINGS;
  sessionStorage.clear();
  lastFetchMock = stubNarrationFetch();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_ENABLE_AI_BRIEFINGS;
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
        projectIds: [],
      },
    }];
    render(<CommandCenterPage />);

    const button = screen.getByRole('button', { name: "Explain today's top three with AI" });
    fireEvent.click(button);

    // The narration card appears with the model badge inside the Top Three card.
    expect(await screen.findByText('Why these three matter today')).toBeInTheDocument();
    expect(screen.getByText('DeepSeek Chat')).toBeInTheDocument();
    expect(screen.getByText(/failing production deploy is the priority today/)).toBeInTheDocument();

    // The rule-based list is still rendered underneath.
    const card = screen.getByRole('heading', { name: "Today's Top Three" }).closest('div.card-base');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText(/Ship onboarding/)).toBeInTheDocument();
  });

  it('shows the Thinking… state and disables the button while the call is in flight', async () => {
    queue = [{
      ok: true, configured: true,
      narration: { paragraph: 'Fix the deploy first.', model: 'deepseek/deepseek-chat', projectIds: [] },
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
    expect(screen.getByText('DeepSeek Chat')).toBeInTheDocument();
  });

  it('sends the per-user OpenRouter model preference with the request', async () => {
    profileOverride = { aiModel: 'anthropic/claude-3.5-sonnet' };
    queue = [{
      ok: true, configured: true,
      narration: { paragraph: 'Fix the deploy first.', model: 'anthropic/claude-3.5-sonnet', projectIds: [] },
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

  it('sends projectId + projectName with each action for cite-back links', async () => {
    queue = [{
      ok: true, configured: true,
      narration: { paragraph: 'The meal planner deploy needs you.', model: 'deepseek/deepseek-chat', projectIds: ['p-1'] },
    }];
    render(<CommandCenterPage />);

    fireEvent.click(screen.getByRole('button', { name: "Explain today's top three with AI" }));

    // The overdue task belongs to p-1, so the request carries its identity.
    await waitFor(() => expect(lastFetchMock).toHaveBeenCalledTimes(1));
    const sentActions = (JSON.parse(
      String((lastFetchMock as unknown as { mock: { calls: Array<[unknown, RequestInit]> } }).mock.calls[0][1]?.body),
    ) as { actions: Array<{ projectId?: string; projectName?: string }> }).actions;
    expect(sentActions.length).toBeGreaterThan(0);
    expect(sentActions.every((a) => a.projectId === 'p-1' && a.projectName === 'Weeknight Meal Planner')).toBe(true);
  });
});

// ─── Regenerate + drill-down ─────────────────────────────────────────────────

describe('CommandCenterPage — regenerate and per-project drill-down', () => {
  it('regenerates the briefing when the refresh button is clicked', async () => {
    queue = [
      {
        ok: true, configured: true,
        narration: { paragraph: 'First take on the day.', model: 'deepseek/deepseek-chat', projectIds: [] },
      },
      {
        ok: true, configured: true,
        narration: { paragraph: 'Fresh take after regenerate.', model: 'deepseek/deepseek-chat', projectIds: [] },
      },
    ];
    render(<CommandCenterPage />);

    fireEvent.click(screen.getByRole('button', { name: "Explain today's top three with AI" }));
    await screen.findByText('First take on the day.');

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate briefing' }));
    expect(await screen.findByText('Fresh take after regenerate.')).toBeInTheDocument();
    expect(screen.queryByText('First take on the day.')).toBeNull();
  });

  it('renders cite-back links for the projects the paragraph refers to', async () => {
    queue = [{
      ok: true, configured: true,
      narration: {
        paragraph: 'The meal planner is the priority today.',
        model: 'deepseek/deepseek-chat',
        projectIds: ['p-1'],
      },
    }];
    render(<CommandCenterPage />);

    fireEvent.click(screen.getByRole('button', { name: "Explain today's top three with AI" }));

    // Scope to the narration callout: the priority queue card also links to
    // /projects/p-1 with the same project name, so query inside the Cited row.
    const citedRow = await screen.findByText('Cited:');
    const link = within(citedRow.closest('div') as HTMLElement).getByRole('link', { name: /Weeknight Meal Planner/ });
    expect(link).toHaveAttribute('href', '/projects/p-1');
  });

  it('re-runs the narration scoped to one project and back to All', async () => {
    // No fetch fires on mount (flag unset), so the chip click is the FIRST call.
    queue = [
      {
        ok: true, configured: true,
        narration: { paragraph: 'Meal planner only.', model: 'deepseek/deepseek-chat', projectIds: ['p-1'] },
      },
      {
        ok: true, configured: true,
        narration: { paragraph: 'Full briefing again.', model: 'deepseek/deepseek-chat', projectIds: [] },
      },
    ];
    render(<CommandCenterPage />);

    // The drill-down chips only appear when a project is involved in the top three.
    const chip = await screen.findByRole('button', { name: 'Weeknight Meal Planner' });
    fireEvent.click(chip);

    expect(await screen.findByText('Meal planner only.')).toBeInTheDocument();
    // Only the scoped project's actions go in the request (the first call).
    const sent = (JSON.parse(
      String((lastFetchMock as unknown as { mock: { calls: Array<[unknown, RequestInit]> } }).mock.calls[0][1]?.body),
    ) as { actions: Array<{ projectId?: string }> }).actions;
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((a) => a.projectId === 'p-1')).toBe(true);

    // Back to the full briefing (second call).
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByText('Full briefing again.')).toBeInTheDocument();
  });

  it('clears the previous scope\'s paragraph while the scoped briefing loads', async () => {
    // With the auto-brief flag off, no fetch fires on mount; the first call is
    // the AI Explain click and the second is the drill-down chip.
    queue = [
      {
        ok: true, configured: true,
        narration: { paragraph: 'Full briefing for everyone.', model: 'deepseek/deepseek-chat', projectIds: [] },
      },
      {
        ok: true, configured: true,
        narration: { paragraph: 'Meal planner scoped.', model: 'deepseek/deepseek-chat', projectIds: ['p-1'] },
      },
    ];
    render(<CommandCenterPage />);

    fireEvent.click(screen.getByRole('button', { name: "Explain today's top three with AI" }));
    await screen.findByText('Full briefing for everyone.');

    // Hold the scoped call open so the in-flight state is observable. The
    // scoped fetch only hits this mock (the first call already used the
    // beforeEach stub), so no queue-length guard is needed.
    let resolveScoped: (() => void) | undefined;
    let scopedStarted = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('/api/ai/top-three')) throw new Error(`Unexpected fetch: ${url}`);
      scopedStarted = true;
      await new Promise<void>((r) => { resolveScoped = r; });
      return { ok: true, status: 200, json: async () => queue[0] } as Response;
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Weeknight Meal Planner' }));

    // The old 'all' paragraph is gone immediately; the skeleton shows because
    // a narration is being generated for the scoped view.
    expect(screen.queryByText('Full briefing for everyone.')).toBeNull();
    expect(screen.getByLabelText('Loading AI briefing')).toBeInTheDocument();

    // Release the scoped response once the request is actually in flight.
    await waitFor(() => expect(scopedStarted).toBe(true));
    resolveScoped?.();
    expect(await screen.findByText('Meal planner scoped.')).toBeInTheDocument();
  });

  it('lets a newer drill-down click win over an in-flight narration (latest request wins)', async () => {
    // Call 1 (AI Explain, all scope) stays in flight; call 2 (drill-down chip)
    // is issued while call 1 is pending and resolves first. When call 1 finally
    // resolves, its stale 'all' paragraph must be discarded, not shown.
    let releaseAllCall: (() => void) | undefined;
    let allCallStarted = false;
    let scopedStarted = false;
    // With only one action in the store, the 'all' and scoped request bodies are
    // identical, so distinguish the two calls by invocation order: call 1 is the
    // held-open all-scope request, call 2 is the immediate drill-down request.
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('/api/ai/top-three')) throw new Error(`Unexpected fetch: ${url}`);
      callCount += 1;
      if (callCount === 1) {
        // The all-scope call stays in flight until the test releases it.
        allCallStarted = true;
        await new Promise<void>((r) => { releaseAllCall = r; });
        return {
          ok: true, status: 200,
          json: async () => ({
            ok: true, configured: true,
            narration: { paragraph: 'Stale all briefing.', model: 'deepseek/deepseek-chat', projectIds: [] },
          }),
        } as Response;
      }
      scopedStarted = true;
      return {
        ok: true, status: 200,
        json: async () => ({
          ok: true, configured: true,
          narration: { paragraph: 'Meal planner wins.', model: 'deepseek/deepseek-chat', projectIds: ['p-1'] },
        }),
      } as Response;
    }));
    render(<CommandCenterPage />);

    // Start the all-scope narration, then immediately drill down while it is
    // in flight. The chip is NOT disabled during narrating, so this is the
    // exact race the review flagged.
    fireEvent.click(screen.getByRole('button', { name: "Explain today's top three with AI" }));
    await waitFor(() => expect(allCallStarted).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Weeknight Meal Planner' }));
    await waitFor(() => expect(scopedStarted).toBe(true));

    // The newer scoped call wins and its paragraph shows with the chip pressed.
    expect(await screen.findByText('Meal planner wins.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weeknight Meal Planner' })).toHaveAttribute('aria-pressed', 'true');

    // The stale all-scope response lands last — it must NOT overwrite the
    // scoped briefing.
    releaseAllCall?.();
    await waitFor(() => expect(screen.queryByText('Stale all briefing.')).toBeNull());
    expect(screen.getByText('Meal planner wins.')).toBeInTheDocument();
  });
});

// ─── Auto-briefing (NEXT_PUBLIC_ENABLE_AI_BRIEFINGS=1) ───────────────────────

describe('CommandCenterPage — auto-briefing on load', () => {
  it('generates the narration on load without a click when the flag is armed', async () => {
    process.env.NEXT_PUBLIC_ENABLE_AI_BRIEFINGS = '1';
    queue = [{
      ok: true, configured: true,
      narration: {
        paragraph: 'The failing production deploy is the priority today: fix it first, then push the unpushed work and close the overdue onboarding task.',
        model: 'deepseek/deepseek-chat',
        projectIds: [],
      },
    }];

    render(<CommandCenterPage />);

    // No click: the narration card appears on its own.
    expect(await screen.findByText('Why these three matter today')).toBeInTheDocument();
    expect(screen.getByText('DeepSeek Chat')).toBeInTheDocument();
    expect(screen.getByText(/failing production deploy is the priority today/)).toBeInTheDocument();
    // The manual regenerate button is still available.
    expect(screen.getByRole('button', { name: "Explain today's top three with AI" })).toBeInTheDocument();
  });

  it('shows the skeleton shimmer while the auto-briefing is in flight', async () => {
    process.env.NEXT_PUBLIC_ENABLE_AI_BRIEFINGS = '1';
    queue = [{
      ok: true, configured: true,
      narration: { paragraph: 'Fix the deploy first.', model: 'deepseek/deepseek-chat', projectIds: [] },
    }];
    // Resolve slowly so the in-flight skeleton is observable.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('/api/ai/top-three')) throw new Error(`Unexpected fetch: ${url}`);
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true, status: 200, json: async () => queue[0] } as Response;
    }));

    render(<CommandCenterPage />);

    // Skeleton shimmer renders while the call is in flight, then the real card.
    expect(screen.getByLabelText('Loading AI briefing')).toBeInTheDocument();
    await screen.findByText('Why these three matter today');
    expect(screen.queryByLabelText('Loading AI briefing')).toBeNull();
  });

  it('does not auto-fire when the flag is unset', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CommandCenterPage />);

    // The fetch stub records calls; nothing should hit the AI route on mount.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Loading AI briefing')).toBeNull();
    expect(screen.queryByText('Why these three matter today')).toBeNull();
  });

  it('falls back to the rule-based list when the auto-briefing returns null', async () => {
    process.env.NEXT_PUBLIC_ENABLE_AI_BRIEFINGS = '1';
    queue = [{ ok: true, configured: false, narration: null }];

    render(<CommandCenterPage />);

    // No narration card, no lingering skeleton — the deterministic list stays.
    await waitFor(() => expect(screen.getAllByText(/Ship onboarding/).length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByLabelText('Loading AI briefing')).toBeNull();
    expect(screen.queryByText('Why these three matter today')).toBeNull();
  });

  it('fires exactly once when actions arrive after mount (async hydration)', async () => {
    process.env.NEXT_PUBLIC_ENABLE_AI_BRIEFINGS = '1';
    queue = [{
      ok: true, configured: true,
      narration: { paragraph: 'Fix the deploy first.', model: 'deepseek/deepseek-chat', projectIds: [] },
    }];
    tasksOverride = []; // Empty store on first mount, like a live fetch in flight.
    const { rerender } = render(<CommandCenterPage />);
    expect(screen.queryByLabelText('Loading AI briefing')).toBeNull();
    expect(lastFetchMock).not.toHaveBeenCalled();

    // Data arrives → re-render with the overdue task, the signature changes and
    // the auto-brief fires without a click.
    tasksOverride = [overdueTask];
    rerender(<CommandCenterPage />);

    expect(await screen.findByText('Why these three matter today')).toBeInTheDocument();
    // Exactly one AI call for the whole lifecycle.
    expect(lastFetchMock).toHaveBeenCalledTimes(1);
  });
});

// ─── sessionStorage persistence (back-nav survival) ─────────────────────────

describe('CommandCenterPage — briefing persistence across remounts', () => {
  it('restores the narration on remount without a new AI call', async () => {
    queue = [{
      ok: true, configured: true,
      narration: { paragraph: 'Persisted briefing text.', model: 'deepseek/deepseek-chat', projectIds: ['p-1'] },
    }];
    const { unmount } = render(<CommandCenterPage />);
    fireEvent.click(screen.getByRole('button', { name: "Explain today's top three with AI" }));
    expect(await screen.findByText('Persisted briefing text.')).toBeInTheDocument();

    // Simulate back navigation: unmount and remount the page fresh. No further
    // AI calls are expected — the paragraph must come back from storage.
    unmount();
    queue = [];
    render(<CommandCenterPage />);

    expect(await screen.findByText('Persisted briefing text.')).toBeInTheDocument();
    expect(screen.getByText('Why these three matter today')).toBeInTheDocument();
    // Only the original generation fired; the remount restored, not re-ran.
    expect(lastFetchMock).toHaveBeenCalledTimes(1);
  });

  it('restores the scoped brief chip and its single-project narration after remount', async () => {
    queue = [{
      ok: true, configured: true,
      narration: { paragraph: 'Scoped to meal planner only.', model: 'deepseek/deepseek-chat', projectIds: ['p-1'] },
    }];
    const { unmount } = render(<CommandCenterPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Weeknight Meal Planner' }));
    expect(await screen.findByText('Scoped to meal planner only.')).toBeInTheDocument();

    unmount();
    queue = [];
    render(<CommandCenterPage />);

    // The paragraph returns AND the chip state survives: Weeknight pressed, All not.
    expect(await screen.findByText('Scoped to meal planner only.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weeknight Meal Planner' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Cited:')).toBeInTheDocument();
  });

  it('discards a stored briefing when the underlying data changed (signature mismatch)', async () => {
    queue = [{
      ok: true, configured: true,
      narration: { paragraph: 'Based on today original data.', model: 'deepseek/deepseek-chat', projectIds: ['p-1'] },
    }];
    const { unmount } = render(<CommandCenterPage />);
    fireEvent.click(screen.getByRole('button', { name: "Explain today's top three with AI" }));
    expect(await screen.findByText('Based on today original data.')).toBeInTheDocument();

    // While away, the overdue task was completed — the top three no longer exists.
    unmount();
    tasksOverride = [];
    render(<CommandCenterPage />);

    expect(screen.queryByText('Based on today original data.')).toBeNull();
    expect(screen.queryByText('Why these three matter today')).toBeNull();
  });

  it('does not auto-fire a new briefing when a stored one is restored', async () => {
    process.env.NEXT_PUBLIC_ENABLE_AI_BRIEFINGS = '1';
    queue = [{
      ok: true, configured: true,
      narration: { paragraph: 'Stored narration, no refire.', model: 'deepseek/deepseek-chat', projectIds: [] },
    }];
    const { unmount } = render(<CommandCenterPage />);
    expect(await screen.findByText('Stored narration, no refire.')).toBeInTheDocument();

    unmount();
    queue = [];
    render(<CommandCenterPage />);

    // Restored from storage, and the auto-brief ref guard stops a duplicate call.
    expect(await screen.findByText('Stored narration, no refire.')).toBeInTheDocument();
    expect(lastFetchMock).toHaveBeenCalledTimes(1);
  });
});
