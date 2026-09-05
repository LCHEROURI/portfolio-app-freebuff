import { render, screen, waitFor } from '@testing-library/react';
import AdvisorPage from '@/app/advisor/page';
import { STORAGE_KEY } from '@/hooks/useAdvisorState';
import { REPORT_STORAGE_KEY } from '@/lib/progress';

// Renders the real client AdvisorPage. Because useAdvisorState hydrates from
// localStorage, seeding `step: 11` lands the page on the Intelligence Report,
// and seeding the report marker makes IntelligenceReport restore straight
// into its generated (printable) view.
function seedAtReportStep() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ step: 11, maxStep: 11 }));
  window.localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify({ savedAt: '2026-09-05T00:00:00Z' }));
}

function seedAtFirstStep() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ step: 1, maxStep: 1 }));
}

async function renderReportStep() {
  seedAtReportStep();
  render(<AdvisorPage />);
  // Wait for hydration: the page restores to step 11 and the report title renders.
  await screen.findByText(/Car Purchase Intelligence Report/i);
}

describe('AdvisorPage print chrome (Prompt 11 — no app navigation in the report)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // jsdom has no fetch; the step-1 VersionMarker calls it during hydration.
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    delete (global as unknown as Record<string, unknown>).fetch;
  });

  it('hides the step header, bottom nav, and footer chrome on the report step', async () => {
    await renderReportStep();

    // Every app-navigation shell element carries the print:hidden utility.
    expect(screen.getByTestId('advisor-chrome').className).toContain('print:hidden');
    expect(screen.getByTestId('advisor-nav').className).toContain('print:hidden');
    expect(screen.getByTestId('advisor-footer').className).toContain('print:hidden');
  });

  it('keeps the generated report itself printable', async () => {
    await renderReportStep();

    // The printable report region is NOT print-hidden (it is what prints),
    // while its on-screen action buttons still are.
    const reportTitle = screen.getByText(/Car Purchase Intelligence Report/i);
    expect(reportTitle.className).not.toContain('print:hidden');

    const printButton = screen.getByRole('button', { name: /print report/i });
    const actionRow = printButton.closest('div');
    expect(actionRow?.className).toContain('print:hidden');
  });

  it('does not hide the chrome on non-report steps', async () => {
    seedAtFirstStep();
    render(<AdvisorPage />);
    await waitFor(() => expect(screen.getByText(/Step 1 of 11/i)).toBeInTheDocument());

    // Step 1 keeps its header/nav/footer on the page (they must only hide
    // when the report is the printable artifact).
    expect(screen.getByTestId('advisor-chrome').className).not.toContain('print:hidden');
    expect(screen.getByTestId('advisor-nav').className).not.toContain('print:hidden');
    expect(screen.getByTestId('advisor-footer').className).not.toContain('print:hidden');
  });
});
