import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProjectDetailPage from './page';
import type { Project, ProjectVersion } from '@/types';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// The page only needs a store facade; stub it instead of mounting StoreProvider.
// The modals (Project/Version/Task/Evaluation) mount closed and only touch the
// store inside their submit handlers, so a minimal facade suffices.
const projectsOverride: Project[] = [];
const versionsOverride: ProjectVersion[] = [];

const baseProject: Project = {
  id: 'p-1', userId: 'e2e-user', name: 'Weeknight Meal Planner', slug: 'weeknight-meal-planner',
  description: '', category: '', businessGoal: '', targetCustomer: '', monetizationModel: '',
  priority: 'P1_HIGH', overallStatus: 'WINNER_SELECTED', overallProgress: 60,
  winningVersionId: 'v-gemini',
  winnerRecommendation: 'Gemini wins on features and overall score.',
  winnerRecommendationModel: 'deepseek/deepseek-chat',
  nextAction: 'Ship', archived: false,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), lastActivityAt: new Date(0).toISOString(),
};

const versionGemini: ProjectVersion = {
  id: 'v-gemini', projectId: 'p-1', userId: 'e2e-user', versionName: 'Gemini Build',
  builder: 'Google AI Studio', model: 'Gemini 1.5 Pro', developmentPlatform: 'AI Studio',
  status: 'TESTING', progress: 70, deploymentIds: [], branch: 'main', lastActivityAt: new Date(0).toISOString(),
  estimatedCost: 10, actualCost: 5, developmentHours: 20, isWinner: true, isArchived: false,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
};

const storeShape = {
  userId: 'e2e-user',
  profile: { defaultStaleDays: 7 },
  projects: projectsOverride,
  versions: versionsOverride,
  repositories: [],
  deployments: [],
  tasks: [],
  evaluations: [],
  activity: [],
  deleteProject: vi.fn(),
  selectWinner: vi.fn(),
  deleteVersion: vi.fn(),
  completeTask: vi.fn(),
  deleteTask: vi.fn(),
};

vi.mock('@/lib/store', () => ({
  useStore: () => storeShape,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'p-1' }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: () => false,
}));

beforeEach(() => {
  projectsOverride.length = 0;
  projectsOverride.push({ ...baseProject });
  versionsOverride.length = 0;
  versionsOverride.push({ ...versionGemini });
});

afterEach(() => {
  // The Save-as-HTML test stubs the global URL (FakeURL) — restore it so the
  // stub never lingers for later tests in this file (mirrors Model Comparison).
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ─── Saved AI winner recommendation on Overview ─────────────────────────────

describe('ProjectDetailPage — saved AI winner recommendation', () => {
  it('shows the recommendation card with the model badge, recommended version, and note on Overview', () => {
    render(<ProjectDetailPage />);

    expect(screen.getByText('AI winner recommendation')).toBeInTheDocument();
    // Friendly model label, not the raw model id.
    expect(screen.getByText('DeepSeek Chat')).toBeInTheDocument();
    expect(screen.getByText(/Recommended: Gemini Build/)).toBeInTheDocument();
    expect(screen.getByText(/Gemini wins on features and overall score\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print winner recommendation for Weeknight Meal Planner' })).toBeInTheDocument();
  });

  it('hides the card entirely when no recommendation is saved', () => {
    projectsOverride[0] = {
      ...baseProject,
      winnerRecommendation: undefined,
      winnerRecommendationModel: undefined,
    };
    render(<ProjectDetailPage />);

    expect(screen.queryByText('AI winner recommendation')).toBeNull();
    expect(screen.queryByRole('button', { name: /Print winner recommendation/ })).toBeNull();
  });
});

// ─── Print the saved AI winner recommendation ───────────────────────────────

// ─── Print the saved AI winner recommendation ───────────────────────────────

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

describe('ProjectDetailPage — print AI winner recommendation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the saved recommendation via the in-page recipe when the popup is blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<ProjectDetailPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Print winner recommendation for Weeknight Meal Planner' }));

    const printArea = screen.getByTestId('print-report');
    expect(within(printArea).getByText(/Weeknight Meal Planner — AI winner recommendation/)).toBeInTheDocument();
    expect(within(printArea).getByText(/Recommended: Gemini Build/)).toBeInTheDocument();
    expect(within(printArea).getByText(/Gemini wins on features and overall score\./)).toBeInTheDocument();
    // Friendly model label, not the raw model id.
    expect(within(printArea).getByText(/DeepSeek Chat/)).toBeInTheDocument();
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));

    // The area is released after the dialog opens — nothing lingers on screen.
    await waitFor(() => expect(screen.queryByTestId('print-report')).toBeNull());
  });

  it('falls back to an ellipsis for the recommended version when no winner resolves', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    // A note can be saved on Model Comparison without selecting a winner, so
    // the card prints with the '…' fallback for the recommended version.
    projectsOverride[0] = {
      ...baseProject,
      winningVersionId: undefined,
      overallStatus: 'TESTING',
    };
    versionsOverride[0] = { ...versionGemini, isWinner: false };
    render(<ProjectDetailPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Print winner recommendation for Weeknight Meal Planner' }));

    const printArea = screen.getByTestId('print-report');
    expect(within(printArea).getByText(/Recommended: …/)).toBeInTheDocument();
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
  });

  it('opens a styled preview window with the recommendation when the popup is allowed', () => {
    const { win, write } = fakePreviewWindow();
    vi.spyOn(window, 'open').mockReturnValue(win);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<ProjectDetailPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Print winner recommendation for Weeknight Meal Planner' }));

    expect(write).toHaveBeenCalledTimes(1);
    const html = String(write.mock.calls[0][0]);
    expect(html).toContain('Weeknight Meal Planner — AI winner recommendation');
    expect(html).toContain('Gemini wins on features and overall score.');
    expect(html).toContain('DeepSeek Chat');
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

describe('ProjectDetailPage — save winner recommendation as HTML', () => {
  it('saves the recommendation as a standalone HTML file sharing the print payload', async () => {
    const { createObjectURL, clickSpy } = stubDownloadWindow();
    render(<ProjectDetailPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Save winner recommendation for Weeknight Meal Planner as HTML' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const html = await blob.text();
    // The exact standalone document the preview renders: title, meta with the
    // recommended version, note callout, and the friendly model label.
    expect(blob.type).toBe('text/html;charset=utf-8');
    expect(html).toContain('Weeknight Meal Planner — AI winner recommendation');
    expect(html).toContain('Gemini wins on features and overall score.');
    expect(html).toContain('DeepSeek Chat');
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('download')).toBe('weeknight-meal-planner-ai-winner-recommendation.html');
  });
});
