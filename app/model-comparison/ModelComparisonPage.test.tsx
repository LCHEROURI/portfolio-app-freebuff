import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ModelComparisonPage from './page';
import type { Project, ProjectVersion, ModelEvaluation } from '@/types';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// The page only needs a store facade; stub it instead of mounting StoreProvider.
// saveProject/selectWinner record calls so the tests can assert persistence.
const saveProjectCalls: Array<Partial<Project>> = [];
const selectWinnerCalls: Array<{ projectId: string; versionId: string }> = [];
// Ordered log of store mutations so tests can assert save/select ordering.
const mutationLog: Array<'saveProject' | 'selectWinner'> = [];

const project: Project = {
  id: 'p-1', userId: 'e2e-user', name: 'Weeknight Meal Planner', slug: 'weeknight-meal-planner',
  description: '', category: '', businessGoal: '', targetCustomer: '', monetizationModel: '',
  priority: 'P1_HIGH', overallStatus: 'TESTING', overallProgress: 60,
  nextAction: 'Ship', archived: false,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), lastActivityAt: new Date(0).toISOString(),
};

const versionGemini: ProjectVersion = {
  id: 'v-gemini', projectId: 'p-1', userId: 'e2e-user', versionName: 'Gemini Build',
  builder: 'Google AI Studio', model: 'Gemini 1.5 Pro', developmentPlatform: 'AI Studio',
  status: 'TESTING', progress: 70, deploymentIds: [], branch: 'main', lastActivityAt: new Date(0).toISOString(),
  estimatedCost: 10, actualCost: 5, developmentHours: 20, isWinner: false, isArchived: false,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
};

const versionKimi: ProjectVersion = {
  ...versionGemini, id: 'v-kimi', versionName: 'Kimi K3 Build', builder: 'Replit', model: 'Kimi K3',
};

const evalGemini: ModelEvaluation = {
  id: 'e-1', userId: 'e2e-user', projectId: 'p-1', projectVersionId: 'v-gemini',
  builder: 'Google AI Studio', model: 'Gemini 1.5 Pro',
  uiScore: 8, featureScore: 9, codeQualityScore: 8, stabilityScore: 8, performanceScore: 7,
  maintainabilityScore: 8, mobileScore: 7, accessibilityScore: 8, developmentSpeedScore: 8, costScore: 7,
  overallScore: 8.2, evaluatedAt: new Date(0).toISOString(), createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
};

const evalKimi: ModelEvaluation = {
  ...evalGemini, id: 'e-2', projectVersionId: 'v-kimi', builder: 'Replit', model: 'Kimi K3',
  overallScore: 7.1,
};

const storeShape = {
  userId: 'e2e-user',
  profile: { defaultStaleDays: 7 },
  projects: [project],
  versions: [versionGemini, versionKimi],
  evaluations: [evalGemini, evalKimi],
  saveProject: async (p: Project) => { mutationLog.push('saveProject'); saveProjectCalls.push(p); },
  selectWinner: async (projectId: string, versionId: string) => { mutationLog.push('selectWinner'); selectWinnerCalls.push({ projectId, versionId }); },
};

vi.mock('@/lib/store', () => ({
  useStore: () => storeShape,
}));

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

// ─── Fetch stub: one queued /api/ai/recommend-winner body per call ──────────

type RecBody = {
  ok: boolean;
  configured: boolean;
  recommendation: { recommendedVersionId: string; note: string; model: string } | null;
};

let queue: RecBody[];

const stubRecFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes('/api/ai/recommend-winner')) {
      throw new Error(`Unexpected fetch in model-comparison test: ${url}`);
    }
    const body = queue.shift();
    if (!body) {
      throw new Error('Unexpected /api/ai/recommend-winner call: response queue exhausted');
    }
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

beforeEach(() => {
  saveProjectCalls.length = 0;
  selectWinnerCalls.length = 0;
  mutationLog.length = 0;
  queue = [];
  // A test may temporarily swap in a project with a saved recommendation;
  // restore the plain fixture so no test inherits another's data.
  storeShape.projects = [project];
  stubRecFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ModelComparisonPage — AI winner recommendation', () => {
  it('shows the AI recommendation panel with the recommended version, editable note, and model badge', async () => {
    queue = [{
      ok: true, configured: true,
      recommendation: { recommendedVersionId: 'v-gemini', note: 'Gemini wins on features and overall score.', model: 'deepseek/deepseek-chat' },
    }];
    render(<ModelComparisonPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Recommend winner for Weeknight Meal Planner' }));

    expect(await screen.findByText('AI winner recommendation')).toBeInTheDocument();
    // 'Gemini Build' appears in the table row AND the recommendation line.
    expect(screen.getAllByText('Gemini Build').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('DeepSeek Chat')).toBeInTheDocument();
    expect(screen.queryByText('AI unavailable — top score shown')).toBeNull();

    const textarea = screen.getByLabelText('Winner recommendation note for Weeknight Meal Planner');
    expect(textarea).toHaveValue('Gemini wins on features and overall score.');
  });

  it('saves the edited note onto the project', async () => {
    queue = [{
      ok: true, configured: true,
      recommendation: { recommendedVersionId: 'v-gemini', note: 'Gemini wins.', model: 'deepseek/deepseek-chat' },
    }];
    render(<ModelComparisonPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Recommend winner for Weeknight Meal Planner' }));
    const textarea = await screen.findByLabelText('Winner recommendation note for Weeknight Meal Planner');

    fireEvent.change(textarea, { target: { value: 'Gemini wins on features. (edited)' } });
    fireEvent.click(screen.getByRole('button', { name: /Save note/ }));

    await waitFor(() => expect(saveProjectCalls.length).toBe(1));
    expect(saveProjectCalls[0].winnerRecommendation).toBe('Gemini wins on features. (edited)');
    expect(saveProjectCalls[0].winnerRecommendationModel).toBe('deepseek/deepseek-chat');
  });

  it('falls back to the deterministic top score with a hint when OpenRouter is unconfigured', async () => {
    queue = [{ ok: true, configured: false, recommendation: null }];
    render(<ModelComparisonPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Recommend winner for Weeknight Meal Planner' }));

    expect(await screen.findByText('AI winner recommendation')).toBeInTheDocument();
    expect(screen.getByText('AI unavailable — top score shown')).toBeInTheDocument();
    // Deterministic fallback highlights Gemini (8.2 > 7.1).
    expect(screen.getAllByText('Gemini Build').length).toBeGreaterThanOrEqual(2);
    // No model badge when the fallback produced no AI.
    expect(screen.queryByText('deepseek/deepseek-chat')).toBeNull();
  });

  it('falls back when the recommend call fails outright', async () => {
    queue = [];
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    render(<ModelComparisonPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Recommend winner for Weeknight Meal Planner' }));

    expect(await screen.findByText('AI unavailable — top score shown')).toBeInTheDocument();
  });

  it('selects the recommended version as winner when asked', async () => {
    queue = [{
      ok: true, configured: true,
      recommendation: { recommendedVersionId: 'v-gemini', note: 'Gemini wins.', model: 'deepseek/deepseek-chat' },
    }];
    render(<ModelComparisonPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Recommend winner for Weeknight Meal Planner' }));
    fireEvent.click(await screen.findByRole('button', { name: /Select as winner/ }));

    await waitFor(() => expect(selectWinnerCalls.length).toBe(1));
    expect(selectWinnerCalls[0]).toEqual({ projectId: 'p-1', versionId: 'v-gemini' });
    // Winner is selected FIRST, then the note is saved carrying the winner
    // fields explicitly — so store.selectWinner's project rebuild can never
    // drop the note (and the save can never clobber the selection).
    expect(mutationLog[0]).toBe('selectWinner');
    await waitFor(() => expect(mutationLog.length).toBe(2));
    expect(mutationLog[1]).toBe('saveProject');
    const noteSave = saveProjectCalls[saveProjectCalls.length - 1];
    expect(noteSave.winnerRecommendation).toBe('Gemini wins.');
    expect(noteSave.winningVersionId).toBe('v-gemini');
    expect(noteSave.overallStatus).toBe('WINNER_SELECTED');
  });
});

// ─── Print the AI winner recommendation ───────────────────────────────────

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

describe('ModelComparisonPage — print AI winner recommendation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the recommendation note, recommended version, and model label via the in-page recipe', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    queue = [{
      ok: true, configured: true,
      recommendation: { recommendedVersionId: 'v-gemini', note: 'Gemini wins on features and overall score.', model: 'deepseek/deepseek-chat' },
    }];
    render(<ModelComparisonPage />);

    // Generate the recommendation first so the print payload carries it.
    fireEvent.click(screen.getByRole('button', { name: 'Recommend winner for Weeknight Meal Planner' }));
    expect(await screen.findByText('AI winner recommendation')).toBeInTheDocument();

    // Print the panel: the print-only area mirrors the recommendation.
    fireEvent.click(screen.getByRole('button', { name: 'Print winner recommendation for Weeknight Meal Planner' }));

    const printArea = screen.getByTestId('print-report');
    expect(within(printArea).getByText(/Weeknight Meal Planner — AI winner recommendation/)).toBeInTheDocument();
    expect(within(printArea).getByText(/Recommended: Gemini Build/)).toBeInTheDocument();
    expect(within(printArea).getByText(/Gemini wins on features and overall score./)).toBeInTheDocument();
    // Friendly model label, not the raw model id.
    expect(within(printArea).getByText(/DeepSeek Chat/)).toBeInTheDocument();
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));

    // The area is released after the dialog opens — nothing lingers on screen.
    await waitFor(() => expect(screen.queryByTestId('print-report')).toBeNull());
  });

  it('prints the editable draft rather than the saved note (what is on screen)', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    queue = [{
      ok: true, configured: true,
      recommendation: { recommendedVersionId: 'v-gemini', note: 'Original AI note.', model: 'deepseek/deepseek-chat' },
    }];
    render(<ModelComparisonPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Recommend winner for Weeknight Meal Planner' }));
    const textarea = await screen.findByLabelText('Winner recommendation note for Weeknight Meal Planner');
    // The user edits the note before printing — the print must carry the edit.
    fireEvent.change(textarea, { target: { value: 'Edited before printing.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Print winner recommendation for Weeknight Meal Planner' }));

    const printArea = screen.getByTestId('print-report');
    expect(within(printArea).getByText(/Edited before printing./)).toBeInTheDocument();
    expect(within(printArea).queryByText(/Original AI note./)).toBeNull();
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
  });

  it('opens a styled preview window with the recommendation when the popup is allowed', async () => {
    const { win, write } = fakePreviewWindow();
    vi.spyOn(window, 'open').mockReturnValue(win);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    queue = [{
      ok: true, configured: true,
      recommendation: { recommendedVersionId: 'v-gemini', note: 'Gemini wins on features.', model: 'deepseek/deepseek-chat' },
    }];
    render(<ModelComparisonPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Recommend winner for Weeknight Meal Planner' }));
    expect(await screen.findByText('AI winner recommendation')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Print winner recommendation for Weeknight Meal Planner' }));

    expect(write).toHaveBeenCalledTimes(1);
    const html = String(write.mock.calls[0][0]);
    expect(html).toContain('Weeknight Meal Planner — AI winner recommendation');
    expect(html).toContain('Gemini wins on features.');
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

describe('ModelComparisonPage — save winner recommendation as HTML', () => {
  it('saves the recommendation as a standalone HTML file sharing the print payload', async () => {
    const { createObjectURL, clickSpy } = stubDownloadWindow();
    queue = [{
      ok: true, configured: true,
      recommendation: { recommendedVersionId: 'v-gemini', note: 'Gemini wins on features and overall score.', model: 'deepseek/deepseek-chat' },
    }];
    render(<ModelComparisonPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Recommend winner for Weeknight Meal Planner' }));
    expect(await screen.findByText('AI winner recommendation')).toBeInTheDocument();

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

// ─── Print all recommendations (one review sheet) ───────────────────────────

describe('ModelComparisonPage — print all recommendations', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('hides the Print all and Save all buttons when no project has a recommendation', () => {
    render(<ModelComparisonPage />);
    expect(screen.queryByRole('button', { name: 'Print all winner recommendations' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save all winner recommendations as HTML' })).toBeNull();
  });

  it('shows the Print all and Save all buttons once a recommendation exists', async () => {
    queue = [{
      ok: true, configured: true,
      recommendation: { recommendedVersionId: 'v-gemini', note: 'Gemini wins.', model: 'deepseek/deepseek-chat' },
    }];
    render(<ModelComparisonPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Recommend winner for Weeknight Meal Planner' }));
    expect(await screen.findByText('AI winner recommendation')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Print all winner recommendations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save all winner recommendations as HTML' })).toBeInTheDocument();
  });

  it('prints one review sheet listing every project recommendation via the in-page recipe', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    queue = [{
      ok: true, configured: true,
      recommendation: { recommendedVersionId: 'v-gemini', note: 'Gemini wins on features and overall score.', model: 'deepseek/deepseek-chat' },
    }];
    render(<ModelComparisonPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Recommend winner for Weeknight Meal Planner' }));
    expect(await screen.findByText('AI winner recommendation')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Print all winner recommendations' }));

    // The review-sheet fallback lists the project, its recommended version,
    // the note, and the friendly model label — one numbered entry per project.
    const printArea = screen.getByTestId('print-report-all');
    expect(within(printArea).getByText(/AI winner recommendations — all projects/)).toBeInTheDocument();
    expect(within(printArea).getByText(/1 AI winner recommendation across all projects/)).toBeInTheDocument();
    expect(within(printArea).getByText(/1\. Weeknight Meal Planner/)).toBeInTheDocument();
    expect(within(printArea).getByText(/Recommended: Gemini Build/)).toBeInTheDocument();
    expect(within(printArea).getByText(/Gemini wins on features and overall score\./)).toBeInTheDocument();
    expect(within(printArea).getByText(/DeepSeek Chat/)).toBeInTheDocument();
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));

    // The area is released after the dialog opens — nothing lingers on screen.
    await waitFor(() => expect(screen.queryByTestId('print-report-all')).toBeNull());
  });

  it('opens a styled preview window with the review sheet when the popup is allowed', async () => {
    const { win, write } = fakePreviewWindow();
    vi.spyOn(window, 'open').mockReturnValue(win);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    queue = [{
      ok: true, configured: true,
      recommendation: { recommendedVersionId: 'v-gemini', note: 'Gemini wins on features.', model: 'deepseek/deepseek-chat' },
    }];
    render(<ModelComparisonPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Recommend winner for Weeknight Meal Planner' }));
    expect(await screen.findByText('AI winner recommendation')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Print all winner recommendations' }));

    expect(write).toHaveBeenCalledTimes(1);
    const html = String(write.mock.calls[0][0]);
    expect(html).toContain('AI winner recommendations — all projects');
    expect(html).toContain('Weeknight Meal Planner');
    expect(html).toContain('Gemini wins on features.');
    expect(html).toContain('DeepSeek Chat');
    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('print-report-all')).toBeNull();
  });

  it('includes a saved recommendation in the review sheet without an AI run', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    // A project with a SAVED winner recommendation (no recs state) still counts:
    // the button shows and the sheet lists the saved note, exactly like the
    // panel does on screen.
    storeShape.projects = [{
      ...project,
      overallStatus: 'WINNER_SELECTED',
      winningVersionId: 'v-gemini',
      winnerRecommendation: 'Saved recommendation note.',
      winnerRecommendationModel: 'deepseek/deepseek-chat',
    }];
    render(<ModelComparisonPage />);

    expect(screen.getByRole('button', { name: 'Print all winner recommendations' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Print all winner recommendations' }));

    const printArea = screen.getByTestId('print-report-all');
    expect(within(printArea).getByText(/1\. Weeknight Meal Planner/)).toBeInTheDocument();
    expect(within(printArea).getByText(/Recommended: Gemini Build/)).toBeInTheDocument();
    expect(within(printArea).getByText(/Saved recommendation note\./)).toBeInTheDocument();
    expect(within(printArea).getByText(/DeepSeek Chat/)).toBeInTheDocument();
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('print-report-all')).toBeNull());
  });

  it('saves the whole review sheet as a standalone HTML file sharing the print payload', async () => {
    const { createObjectURL, clickSpy } = stubDownloadWindow();
    queue = [{
      ok: true, configured: true,
      recommendation: { recommendedVersionId: 'v-gemini', note: 'Gemini wins on features and overall score.', model: 'deepseek/deepseek-chat' },
    }];
    render(<ModelComparisonPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Recommend winner for Weeknight Meal Planner' }));
    expect(await screen.findByText('AI winner recommendation')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save all winner recommendations as HTML' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const html = await blob.text();
    // The exact standalone document the review-sheet preview renders: title,
    // meta with the recommendation count, the numbered project entry, the
    // note, and the friendly model label.
    expect(blob.type).toBe('text/html;charset=utf-8');
    expect(html).toContain('AI winner recommendations — all projects');
    expect(html).toContain('Weeknight Meal Planner');
    expect(html).toContain('Gemini wins on features and overall score.');
    expect(html).toContain('DeepSeek Chat');
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('download')).toBe('ai-winner-recommendations-all-projects.html');
  });
});
