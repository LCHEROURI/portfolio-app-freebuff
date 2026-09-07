import { render, screen, waitFor } from '@testing-library/react';
import AdvisorPage from '@/app/advisor/page';
import { STORAGE_KEY } from '@/hooks/useAdvisorState';
import { REPORT_STORAGE_KEY } from '@/lib/progress';
import { saveAdvisorReport } from '@/lib/savedReports';

// Renders the real client AdvisorPage. Seeding `step: N` makes useAdvisorState
// hydrate to that step so the shell header (the single source of truth) shows.
function seedStep(step: number) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, maxStep: step }));
}

describe('AdvisorPage step headers (single source of truth — one header, 11 steps)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Keep the URL clean between tests so a restore test's query string
    // cannot leak into a later test's hydration.
    window.history.replaceState({}, '', '/advisor');
    // jsdom has no fetch; the step-1 VersionMarker calls it before hydration
    // moves the page off step 1.
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    delete (global as unknown as Record<string, unknown>).fetch;
  });

  it('renders one header per step with the correct 11-step total', async () => {
    // Step 2 is the first step whose component used to embed its own
    // 'Step 2 of 10' duplicate header on top of the shell's 'Step 2 of 11'.
    seedStep(2);
    render(<AdvisorPage />);

    await waitFor(() =>
      expect(
        screen.getAllByRole('heading', { name: /Step 2 of 11 — Compare your vehicles/i }),
      ).toHaveLength(1),
    );
    // No component may reintroduce a wrong-total embedded header.
    expect(screen.queryByText(/Step \d of 10/)).not.toBeInTheDocument();
  });

  it('keeps the report step on a single header too', async () => {
    seedStep(11);
    render(<AdvisorPage />);

    await waitFor(() =>
      expect(
        screen.getAllByRole('heading', { name: /Step 11 of 11 — Intelligence report/i }),
      ).toHaveLength(1),
    );
    expect(screen.queryByText(/Step \d of 10/)).not.toBeInTheDocument();
  });

  it('restores a saved report from /advisor?report=<id> onto Step 11', async () => {
    const saved = saveAdvisorReport(
      {
        step: 2,
        maxStep: 2,
        intake: { monthlyBudget: '400' },
        dealScore: { input: {}, result: { score: 55, breakdown: [] } },
      },
      '2026-09-07T12:00:00.000Z',
    );
    expect(saved).not.toBeNull();
    window.history.replaceState({}, '', `/advisor?report=${saved?.id}`);

    render(<AdvisorPage />);

    await waitFor(() =>
      expect(
        screen.getAllByRole('heading', { name: /Step 11 of 11 — Intelligence report/i }),
      ).toHaveLength(1),
    );

    // The saved snapshot replaced the live session and persisted at step 11.
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const persisted = raw
      ? (JSON.parse(raw) as { step: number; dealScore?: { result?: { score?: number } } })
      : null;
    expect(persisted?.step).toBe(11);
    expect(persisted?.dealScore?.result?.score).toBe(55);

    // The report-generated marker is set so the restored report renders.
    expect(window.localStorage.getItem(REPORT_STORAGE_KEY)).not.toBeNull();

    // The query string was cleaned up so a refresh keeps the session.
    expect(window.location.search).toBe('');
  });

  it('ignores an unknown report id and stays on the current step', async () => {
    seedStep(3);
    window.history.replaceState({}, '', '/advisor?report=does-not-exist');

    render(<AdvisorPage />);

    await waitFor(() =>
      expect(
        screen.getAllByRole('heading', { name: /Step 3 of 11 — Run the financing math/i }),
      ).toHaveLength(1),
    );
    expect(window.location.search).toBe('');
  });
});
