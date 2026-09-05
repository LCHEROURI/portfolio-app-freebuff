import { render, screen, waitFor } from '@testing-library/react';
import AdvisorPage from '@/app/advisor/page';
import { STORAGE_KEY } from '@/hooks/useAdvisorState';

// Renders the real client AdvisorPage. Seeding `step: N` makes useAdvisorState
// hydrate to that step so the shell header (the single source of truth) shows.
function seedStep(step: number) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, maxStep: step }));
}

describe('AdvisorPage step headers (single source of truth — one header, 11 steps)', () => {
  beforeEach(() => {
    window.localStorage.clear();
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
});
