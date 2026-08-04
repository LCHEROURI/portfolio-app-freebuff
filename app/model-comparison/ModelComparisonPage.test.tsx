import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByText('deepseek/deepseek-chat')).toBeInTheDocument();
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
