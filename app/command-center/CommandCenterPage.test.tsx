import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CommandCenterPage from './page';
import type { Project, ProjectVersion, Repository, Task } from '@/types';

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
// Repository scanner facts: a queue item built on unpushed/uncommitted data
// needs a version wired to a repo so repoOfQueueItem resolves it.
let versionsOverride: ProjectVersion[] = [];
let reposOverride: Repository[] = [];

vi.mock('@/lib/store', () => ({
  useStore: () => ({
    userId: 'e2e-user',
    mode: 'demo',
    profile: {
      id: 'e2e-user', name: 'E2E', timezone: 'UTC',
      dailyReportEnabled: true, dailyReportTime: '07:00',
      weeklyReportEnabled: true, weeklyReportDay: 1, weeklyReportTime: '07:00',
      defaultStaleDays: 7, ...profileOverride,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    },
    projects: [project],
    versions: versionsOverride,
    repositories: reposOverride,
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

// The page also mounts the LastScanStrip, which fetches GET /api/scans on
// mount; route that to an empty feed so the AI stubs below only ever see
// /api/ai/top-three calls.
const aiCalls = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.filter((c) => String(c[0]).includes('/api/ai/top-three'));

const stubNarrationFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/scans')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, repos: [] }) } as Response;
    }
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
  versionsOverride = [];
  reposOverride = [];
  delete process.env.NEXT_PUBLIC_ENABLE_AI_BRIEFINGS;
  sessionStorage.clear();
  lastFetchMock = stubNarrationFetch();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_ENABLE_AI_BRIEFINGS;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
    await waitFor(() => expect(aiCalls(lastFetchMock as ReturnType<typeof vi.fn>)).toHaveLength(1));
    const sentActions = (JSON.parse(
      String((aiCalls(lastFetchMock as ReturnType<typeof vi.fn>)[0][1] as RequestInit | undefined)?.body),
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
    // Only the scoped project's actions go in the request (the first AI call).
    const sent = (JSON.parse(
      String((aiCalls(lastFetchMock as ReturnType<typeof vi.fn>)[0][1] as RequestInit | undefined)?.body),
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/scans')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, repos: [] }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CommandCenterPage />);

    // The strip's /api/scans feed may load, but no AI route is hit on mount.
    expect(aiCalls(fetchMock)).toHaveLength(0);
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
    // The strip may fetch /api/scans, but no AI call fires while the store is empty.
    expect(aiCalls(lastFetchMock as ReturnType<typeof vi.fn>)).toHaveLength(0);

    // Data arrives → re-render with the overdue task, the signature changes and
    // the auto-brief fires without a click.
    tasksOverride = [overdueTask];
    rerender(<CommandCenterPage />);

    expect(await screen.findByText('Why these three matter today')).toBeInTheDocument();
    // Exactly one AI call for the whole lifecycle (ignoring the /api/scans feed).
    expect(aiCalls(lastFetchMock as ReturnType<typeof vi.fn>)).toHaveLength(1);
  });
});

// ─── Print today's top three ─────────────────────────────────────────────────

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

// Printing prefers a styled preview window (usePrint) and only falls back to
// the in-page .print-report recipe when the popup is blocked. These tests mock
// window.open to return null so the in-page fallback runs, then assert the
// print-only area mirrored the narration + ranked actions and window.print
// fired.
describe('CommandCenterPage — print top three briefing', () => {
  const blockPopup = () => vi.spyOn(window, 'open').mockReturnValue(null);

  it('prints the AI briefing narration and the ranked action list', async () => {
    blockPopup();
    const printMock = vi.fn();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(printMock);
    queue = [{
      ok: true, configured: true,
      narration: {
        paragraph: 'Fix the failing deploy first, then ship onboarding.',
        model: 'deepseek/deepseek-chat',
        projectIds: [],
      },
    }];
    render(<CommandCenterPage />);

    // Generate the briefing first so the print payload carries the narration.
    fireEvent.click(screen.getByRole('button', { name: "Explain today's top three with AI" }));
    expect(await screen.findByText('Why these three matter today')).toBeInTheDocument();

    // Print the card: the print-only area mirrors the narration + the actions.
    fireEvent.click(screen.getByRole('button', { name: "Print today's top three" }));

    const printArea = screen.getByTestId('print-report');
    expect(within(printArea).getByText(/Why these three matter today/)).toBeInTheDocument();
    expect(within(printArea).getByText(/Fix the failing deploy first/)).toBeInTheDocument();
    expect(within(printArea).getByText(/1\. .*Ship onboarding/)).toBeInTheDocument();
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));

    // The area is released after the dialog opens — nothing lingers on screen.
    await waitFor(() => expect(screen.queryByTestId('print-report')).toBeNull());
  });

  it('prints the ranked list alone when there is no AI briefing', async () => {
    blockPopup();
    const printMock = vi.fn();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(printMock);
    render(<CommandCenterPage />);

    fireEvent.click(screen.getByRole('button', { name: "Print today's top three" }));

    const printArea = screen.getByTestId('print-report');
    expect(within(printArea).getByText(/1\. .*Ship onboarding/)).toBeInTheDocument();
    // No narration block when the briefing was never generated.
    expect(within(printArea).queryByText(/Why these three matter today/)).toBeNull();
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('print-report')).toBeNull());
  });

  it('opens a styled preview window with the narration and ranked list when the popup is allowed', async () => {
    const { win, write } = fakePreviewWindow();
    vi.spyOn(window, 'open').mockReturnValue(win);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    queue = [{
      ok: true, configured: true,
      narration: {
        paragraph: 'Fix the failing deploy first, then ship onboarding.',
        model: 'deepseek/deepseek-chat',
        projectIds: [],
      },
    }];
    render(<CommandCenterPage />);

    // Generate the briefing first so the preview carries the narration.
    fireEvent.click(screen.getByRole('button', { name: "Explain today's top three with AI" }));
    expect(await screen.findByText('Why these three matter today')).toBeInTheDocument();

    // Print: the preview window receives the standalone document with the
    // narration callout and the ranked list; the in-page recipe never renders
    // and the browser dialog does not open directly.
    fireEvent.click(screen.getByRole('button', { name: "Print today's top three" }));

    expect(write).toHaveBeenCalledTimes(1);
    const html = String(write.mock.calls[0][0]);
    expect(html).toContain('Why these three matter today');
    expect(html).toContain('Fix the failing deploy first, then ship onboarding.');
    expect(html).toContain('Ship onboarding');
    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('print-report')).toBeNull();
  });
});

// ─── Download PDF ────────────────────────────────────────────────────────────

// Downloading renders the SAME PrintDoc the preview shows through the shared
// /api/print/pdf route, then saves the returned blob. jsdom lacks
// URL.createObjectURL and blob: navigation, so a URL subclass stubs the two
// statics and the anchor click is spied.

describe('CommandCenterPage — download top three PDF', () => {
  it('downloads the briefing as a PDF, including the AI narration when present', async () => {
    const { createObjectURL, clickSpy } = stubDownloadWindow();
    let pdfBody: unknown;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/scans')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, repos: [] }) } as Response;
      }
      if (url.includes('/api/ai/top-three')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            ok: true, configured: true,
            narration: {
              paragraph: 'Fix the failing deploy first, then ship onboarding.',
              model: 'deepseek/deepseek-chat',
              projectIds: [],
            },
          }),
        } as Response;
      }
      if (url.includes('/api/print/pdf')) {
        pdfBody = JSON.parse(String(init?.body));
        return {
          ok: true, status: 200,
          blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
        } as unknown as Response;
      }
      throw new Error(`Unexpected fetch in command-center pdf test: ${url}`);
    }));
    render(<CommandCenterPage />);

    // Generate the briefing first so the PDF carries the narration.
    fireEvent.click(screen.getByRole('button', { name: "Explain today's top three with AI" }));
    expect(await screen.findByText('Why these three matter today')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: "Download today's top three as PDF" }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    // The request carried the same PrintDoc the preview renders: the narration
    // callout plus the ranked action list.
    expect((pdfBody as { title: string }).title).toBe("Today's Top Three");
    expect((pdfBody as { callouts: Array<{ heading: string }> }).callouts[0].heading).toBe('Why these three matter today');
    expect((pdfBody as { list: unknown[] }).list).toHaveLength(1);
  });

  it('shows a targeted error when the PDF route is unavailable', async () => {
    stubDownloadWindow();
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
      throw new Error(`Unexpected fetch in command-center pdf test: ${url}`);
    }));
    render(<CommandCenterPage />);

    fireEvent.click(screen.getByRole('button', { name: "Download today's top three as PDF" }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Headless Chrome not available here.');
  });

  it('disables the Download PDF button while a download is in flight (double-click race lock)', async () => {
    const { clickSpy } = stubDownloadWindow();
    // A deferred promise held open so pdfBusy stays true mid-flight; released
    // manually to complete the download and re-enable the button.
    let release!: (res: Response) => void;
    const pendingPdf = new Promise<Response>((res) => { release = res; });
    let pdfCalls = 0;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/scans')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, repos: [] }) } as Response);
      }
      if (url.includes('/api/print/pdf')) {
        pdfCalls += 1;
        return pendingPdf;
      }
      throw new Error(`Unexpected fetch in command-center pdf race test: ${url}`);
    }));
    render(<CommandCenterPage />);

    const pdfButton = screen.getByRole('button', { name: "Download today's top three as PDF" });
    expect(pdfButton).toBeEnabled();

    fireEvent.click(pdfButton);

    // pdfBusy is set synchronously before the request is awaited: the button
    // is disabled for the whole flight, so a second click cannot start a
    // concurrent POST. The fetch itself fires after getAuthToken resolves, so
    // wait for it before counting.
    expect(pdfButton).toBeDisabled();
    await waitFor(() => expect(pdfCalls).toBe(1));
    fireEvent.click(pdfButton);
    // The disabled button is inert — still exactly one in-flight POST.
    expect(pdfCalls).toBe(1);

    // Complete the flight: the download lands and the button re-enables.
    release({
      ok: true, status: 200,
      blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
    } as unknown as Response);
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pdfButton).toBeEnabled());
    expect(pdfCalls).toBe(1);
  });
});

// ─── Save as HTML ───────────────────────────────────────────────────────────

// 'Save as HTML' is a PURE client-side download: the SAME standalone document
// the preview window writes (buildPreviewHtml) becomes a blob saved via an
// <a download> — no route, no auth, no printer. The page's shared fetch stub
// throws on any unexpected URL, so these tests prove the button never touches
// the server (no /api/print/pdf round-trip).

describe('CommandCenterPage — save top three as HTML', () => {
  it('saves the ranked action list as a standalone HTML file', async () => {
    const { createObjectURL, clickSpy } = stubDownloadWindow();
    render(<CommandCenterPage />);

    fireEvent.click(screen.getByRole('button', { name: "Save today's top three as HTML" }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const html = await blob.text();
    // The exact standalone document: toolbar, title, meta, ranked list. The
    // apostrophe in the title is HTML-escaped (&#39;s) — proof the document is
    // built through the shared escape path, never interpolated raw.
    expect(blob.type).toBe('text/html;charset=utf-8');
    expect(html).toContain('class="btn-print"');
    expect(html).toContain('Today&#39;s Top Three');
    expect(html).toContain('Ship onboarding');
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('download')).toBe('today-s-top-three.html');
  });

  it('includes the AI narration callout when a briefing has been generated', async () => {
    const { createObjectURL, clickSpy } = stubDownloadWindow();
    queue = [{
      ok: true, configured: true,
      narration: {
        paragraph: 'Fix the failing deploy first, then ship onboarding.',
        model: 'deepseek/deepseek-chat',
        projectIds: [],
      },
    }];
    render(<CommandCenterPage />);

    // Generate the briefing first so the saved document carries the narration.
    fireEvent.click(screen.getByRole('button', { name: "Explain today's top three with AI" }));
    expect(await screen.findByText('Why these three matter today')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: "Save today's top three as HTML" }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const html = await blob.text();
    expect(html).toContain('Why these three matter today');
    expect(html).toContain('Fix the failing deploy first, then ship onboarding.');
    // Friendly model label, not the raw id.
    expect(html).toContain('DeepSeek Chat');
  });
});

// Shared download stub for BOTH client-side export paths ('Save as HTML' and
// 'Download PDF'): jsdom lacks URL.createObjectURL and blob: navigation, so a
// URL subclass stubs the two statics and the anchor click is spied. One
// helper for both surfaces so the two download test setups can never drift.
const stubDownloadWindow = () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:fake');
  const revokeObjectURL = vi.fn();
  class FakeURL extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  }
  vi.stubGlobal('URL', FakeURL as unknown as typeof URL);
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  return { createObjectURL, revokeObjectURL, clickSpy };
};

// ─── Stale-scan badge tooltip on the priority queue ─────────────────────────

describe('CommandCenterPage — stale-scan queue badge tooltip', () => {
  it('shows the exact capture time and hours-old figure on a stale unpushed item', () => {
    // Wire a version to a repo whose scanner facts are 3 days old and carry
    // unpushed commits — this produces an UNPUSHED queue item with a stale
    // scan, exactly the Repositories-grid surface the tooltip must match.
    versionsOverride = [{
      id: 'v-1', projectId: 'p-1', userId: 'e2e-user', versionName: 'V1',
      builder: 'Codex', model: 'GPT-4o Codex', developmentPlatform: 'web',
      status: 'TESTING', progress: 60, deploymentIds: [], branch: 'main',
      lastActivityAt: new Date(0).toISOString(), estimatedCost: 0, actualCost: 0,
      developmentHours: 0, isWinner: false, isArchived: false,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    }];
    reposOverride = [{
      id: 'r-1', userId: 'e2e-user', projectVersionId: 'v-1', provider: 'github',
      owner: 'LCHEROURI', repositoryName: 'portfolio-app-freebuff',
      repositoryUrl: 'https://github.com/LCHEROURI/portfolio-app-freebuff',
      defaultBranch: 'main', currentBranch: 'main', private: true,
      openPullRequests: 0, openIssues: 0, commitsAhead: 3, commitsBehind: 0,
      hasUncommittedChanges: true, hasUnpushedCommits: true,
      lastScannedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      connectionStatus: 'CONNECTED',
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    }];
    render(<CommandCenterPage />);

    // The queue item carries the shared freshness badge (same text as the
    // grid), and its tooltip is the enhanced exact-clock one — not the coarse
    // 'Local scanner captured this repo …' inline title.
    const badge = screen.getByText(/stale scan · 3d ago/);
    const title = badge.closest('span')?.getAttribute('title') ?? '';
    expect(title).toContain('Scanned');
    expect(title).toContain('72h old');
    expect(title).toContain('local facts may be out of date');
  });
});

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
    expect(aiCalls(lastFetchMock as ReturnType<typeof vi.fn>)).toHaveLength(1);
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
    expect(aiCalls(lastFetchMock as ReturnType<typeof vi.fn>)).toHaveLength(1);
  });
});
