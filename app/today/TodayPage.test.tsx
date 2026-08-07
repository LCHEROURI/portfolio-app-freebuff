import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TodayPage from './page';
import type { Project, Task } from '@/types';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// The page only needs a store facade; stub it instead of mounting StoreProvider.
// The store shape must satisfy the pure engine builders (buildTopThree,
// isDueToday, isOverdue) — an overdue task is enough to produce a non-empty
// Top Three, exactly like the Command Center test.
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

// Mutable store slices so tests can flip them and re-render (async hydration
// simulation), matching the Command Center test's override pattern.
let tasksOverride: Task[] = [overdueTask];

vi.mock('@/lib/store', () => ({
  useStore: () => ({
    userId: 'e2e-user',
    mode: 'demo',
    profile: {
      id: 'e2e-user', name: 'E2E', timezone: 'UTC',
      dailyReportEnabled: true, dailyReportTime: '07:00',
      weeklyReportEnabled: true, weeklyReportDay: 1, weeklyReportTime: '07:00',
      defaultStaleDays: 7,
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
    saveTask: async () => {},
    completeTask: async () => {},
  }),
}));

vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: () => false,
}));

beforeEach(() => {
  tasksOverride = [overdueTask];
  vi.restoreAllMocks();
});

afterEach(() => {
  // The Save-as-HTML test stubs the global URL (FakeURL) — restore it so the
  // stub never lingers for later tests in this file (mirrors Command Center).
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('TodayPage — Top Three hero print', () => {
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

  it('shows the Print button on the hero only when there are actions', () => {
    const { rerender } = render(<TodayPage />);
    expect(screen.getByRole('button', { name: "Print today's top three" })).toBeInTheDocument();

    // With no tasks there is nothing to print, so the button disappears.
    tasksOverride = [];
    rerender(<TodayPage />);
    expect(screen.queryByRole('button', { name: "Print today's top three" })).toBeNull();
  });

  it('falls back to the in-page recipe + window.print when the popup is blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    render(<TodayPage />);

    fireEvent.click(screen.getByRole('button', { name: "Print today's top three" }));

    // The print-only area mirrors the ranked action list with project context.
    const printArea = screen.getByTestId('print-report');
    expect(within(printArea).getByText(/Today's Top Three/)).toBeInTheDocument();
    expect(within(printArea).getByText(/1\. .*Ship onboarding/)).toBeInTheDocument();
    // The project name appears in the list item span AND inside the ranked
    // description — assert at least one occurrence.
    expect(within(printArea).getAllByText(/Weeknight Meal Planner/).length).toBeGreaterThan(0);
    // The description carries the rule priority as its rank (the overdue rule
    // uses priority 3, distinct from the list position 1).
    expect(within(printArea).getByText(/rank \d+/)).toBeInTheDocument();
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));

    // The area is released after the dialog opens — nothing lingers on screen.
    await waitFor(() => expect(screen.queryByTestId('print-report')).toBeNull());
  });

  it('opens a styled preview window with the ranked list when the popup is allowed', () => {
    const { win, write } = fakePreviewWindow();
    vi.spyOn(window, 'open').mockReturnValue(win);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    render(<TodayPage />);

    fireEvent.click(screen.getByRole('button', { name: "Print today's top three" }));

    expect(write).toHaveBeenCalledTimes(1);
    const html = String(write.mock.calls[0][0]);
    expect(html).toContain('Today&#39;s Top Three');
    expect(html).toContain('Ship onboarding');
    expect(html).toContain('Weeknight Meal Planner');
    expect(html).toContain('btn-print');
    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('print-report')).toBeNull();
  });
});

// ─── Save as HTML ───────────────────────────────────────────────────────────

// 'Save as HTML' is a PURE client-side download: the SAME standalone document
// the preview window writes (buildPreviewHtml) becomes a blob saved via an
// <a download> — no route, no auth, no printer.

// Shared download stub: jsdom lacks URL.createObjectURL and blob: navigation,
// so a URL subclass stubs the two statics and the anchor click is spied.
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

describe('TodayPage — save top three as HTML', () => {
  it('saves the ranked action list as a standalone HTML file sharing the print payload', async () => {
    const { createObjectURL, clickSpy } = stubDownloadWindow();
    render(<TodayPage />);

    fireEvent.click(screen.getByRole('button', { name: "Save today's top three as HTML" }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const html = await blob.text();
    // The exact standalone document: toolbar, escaped title, ranked list with
    // project context — the same payload the Print button renders.
    expect(blob.type).toBe('text/html;charset=utf-8');
    expect(html).toContain('class="btn-print"');
    expect(html).toContain('Today&#39;s Top Three');
    expect(html).toContain('Ship onboarding');
    expect(html).toContain('Weeknight Meal Planner');
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('download')).toBe('today-s-top-three.html');
  });

  it('hides the Save as HTML button when there are no actions', () => {
    tasksOverride = [];
    render(<TodayPage />);
    expect(screen.queryByRole('button', { name: "Save today's top three as HTML" })).toBeNull();
  });
});
