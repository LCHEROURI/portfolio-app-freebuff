import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import IntelligenceReport from '@/components/advisor/IntelligenceReport';
import type { AdvisorState } from '@/hooks/useAdvisorState';

// The download filename embeds generate-time date; tests that assert it pin
// the clock so they are deterministic no matter which day CI runs on.
const FIXED_NOW = new Date('2026-09-03T12:00:00Z');

// A session store shaped like what the advisor flow saves across the steps.
const RICH_STATE: AdvisorState = {
  step: 11,
  intake: { monthlyBudget: '4500', downPayment: '5000', creditRange: 'good' },
  finance: { vehiclePrice: '32000', downPayment: '5000', apr: '6', termMonths: '60' },
  trade: { tradeValue: '12000', payoff: '9000' },
  fees: { docFee: '299', titleRegistration: '345', addOnsText: 'Fabric Protection, Nitrogen Tires' },
  ownership: { monthlyLoan: '500', insurance: '120', fuel: '150', maintenance: '75', registration: '30', parking: '0', taxesAndFees: '40', other: '0' },
  vehicles: {
    needs: { awd: true, appleCarPlay: true },
    comparing: ['camry', 'outback'],
    names: { camry: 'Toyota Camry', outback: 'Subaru Outback' },
    specs: {
      camry: { title: '2025 Toyota Camry LE', msrp: 28595, mpg: 33, seating: 5, drive: 'fwd', safety: 'IIHS Top Safety Pick+' },
      outback: { title: '2025 Subaru Outback Premium', msrp: 32495, mpg: 29, seating: 5, drive: 'awd', safety: 'IIHS Top Safety Pick+' },
    },
  },
  dealScore: {
    input: {},
    result: {
      score: 72,
      breakdown: [
        { label: 'Financing affordability', points: 25, maxPoints: 25, earned: 25, reason: 'fits' },
        { label: 'No unnecessary add-ons', points: 20, maxPoints: 20, earned: 10, reason: 'some' },
      ],
    },
  },
};

function generateReport(advisor?: AdvisorState) {
  render(<IntelligenceReport advisor={advisor} />);
  fireEvent.click(screen.getByLabelText(/educational guidance/i));
  fireEvent.click(screen.getByRole('button', { name: /generate report/i }));
}

describe('IntelligenceReport', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('blocks report generation until consent is checked', () => {
    render(<IntelligenceReport />);
    const button = screen.getByRole('button', { name: /generate report/i });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/educational guidance/i));
    expect(button).toBeEnabled();
  });

  it('renders every section filled from the saved session data', () => {
    generateReport(RICH_STATE);
    expect(screen.getByText(/Car Purchase Intelligence Report/i)).toBeInTheDocument();

    // Budget (Step 1)
    expect(screen.getByText('$4,500')).toBeInTheDocument();
    // Financing (Step 3): 27000 financed at 6% for 60mo = 521.99/mo — computed live, not stored
    // Exact match: the comparison table's "Est. monthly payment" row also exists.
    expect(screen.getByText('Monthly payment')).toBeInTheDocument();
    expect(screen.getByText(/\$522/)).toBeInTheDocument();
    // Trade (Step 7): 12000 - 9000 = +3000
    expect(screen.getByText('+$3,000')).toBeInTheDocument();
    // Fees (Step 8): 299 doc fee flags red + the high-margin add-on list
    expect(screen.getByText('$299')).toBeInTheDocument();
    expect(screen.getByText(/documentation fee is above/i)).toBeInTheDocument();
    expect(screen.getAllByText(/high-margin add-on detected/i).length).toBeGreaterThan(0);
    // Ownership (Step 5): 500+120+150+75+30+0+40+0 = 915
    expect(screen.getByText('$915')).toBeInTheDocument();
    // Needs (Step 2)
    expect(screen.getByText('All-wheel drive')).toBeInTheDocument();
    expect(screen.getByText('Apple CarPlay')).toBeInTheDocument();
    expect(screen.getByText(/2 vehicles marked for comparison/i)).toBeInTheDocument();
    // Deal score (Step 10)
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('25/25')).toBeInTheDocument();
  });

  it('shows per-step empty states when the store is empty', () => {
    generateReport(undefined);
    expect(screen.getAllByText(/not completed yet/i).length).toBeGreaterThanOrEqual(6);
    // And the pre-generation tip warned about it:
  });

  it('warns before generating with no saved session data', () => {
    render(<IntelligenceReport />);
    expect(screen.getByText(/you have not saved any step data yet/i)).toBeInTheDocument();
  });

  it('warns when a payment exceeds the budget', () => {
    const over: AdvisorState = {
      ...RICH_STATE,
      intake: { monthlyBudget: '300' },
    };
    generateReport(over);
    expect(screen.getByText(/over your monthly budget/i)).toBeInTheDocument();
  });

  it('shows negative-equity warning for an underwater trade', () => {
    const underwater: AdvisorState = {
      ...RICH_STATE,
      trade: { tradeValue: '8000', payoff: '11000' },
    };
    generateReport(underwater);
    expect(screen.getByText(/negative equity/i)).toBeInTheDocument();
  });

  it('shows the clean-quote message when no fee flags fire', () => {
    const clean: AdvisorState = {
      ...RICH_STATE,
      fees: { docFee: '129', titleRegistration: '345', addOnsText: '' },
    };
    generateReport(clean);
    expect(screen.getByText(/no red flags detected/i)).toBeInTheDocument();
  });

  it('supports the legacy print path after generation', () => {
    generateReport(RICH_STATE);
    expect(screen.getByRole('button', { name: /print report/i })).toBeInTheDocument();
  });

  it('offers Start Over in the generated view and shows a confirmation dialog', () => {
    generateReport(RICH_STATE);
    fireEvent.click(screen.getByTestId('start-over'));
    expect(screen.getByTestId('reset-confirm')).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it('cancel keeps the generated report', () => {
    generateReport(RICH_STATE);
    fireEvent.click(screen.getByTestId('start-over'));
    fireEvent.click(screen.getByTestId('reset-confirm-no'));
    expect(screen.queryByTestId('reset-confirm')).not.toBeInTheDocument();
    expect(screen.getByText(/Car Purchase Intelligence Report/i)).toBeInTheDocument();
  });

  it('downloads the report as a Markdown file when Download is clicked', () => {
    generateReport(RICH_STATE);

    // jsdom lacks blob URL APIs — stub them; capture the anchor via its click.
    const revokeSpy = jest.fn();
    URL.createObjectURL = jest.fn(() => 'blob:mock-url') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeSpy as unknown as typeof URL.revokeObjectURL;
    let clicked: HTMLAnchorElement | null = null;
    // Capture the anchor from `this` inside the mock — reading `this` is fine;
    // the ESLint rule only forbids aliasing it to a local variable.
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked = arguments.length >= 0 && this instanceof HTMLAnchorElement ? this : null;
      });

    fireEvent.click(screen.getByTestId('download-report'));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clicked as unknown as HTMLAnchorElement;
    expect(anchor).not.toBeNull();
    expect(anchor.download).toMatch(/^car-purchase-intelligence-report-\d{4}-\d{2}-\d{2}(-[a-z0-9-]+)?\.md$/);
    expect(anchor.href).toBe('blob:mock-url');
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url');

    clickSpy.mockRestore();
  });

  function stubClipboard(impl: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn(impl) },
      configurable: true,
    });
  }

  afterEach(() => {
    // Remove the clipboard stub so other tests see the default navigator.
    delete (navigator as unknown as Record<string, unknown>).clipboard;
  });

  it('copies the report Markdown to the clipboard and shows Copied!', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    stubClipboard((text: string) => writeText(text));
    generateReport(RICH_STATE);

    fireEvent.click(screen.getByTestId('copy-report'));
    await waitFor(() => expect(screen.getByText('Copied!')).toBeInTheDocument());

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('# Car Purchase Intelligence Report');
    expect(copied).toContain('- Monthly budget: $4,500');
  });

  it('shows Copy failed when the clipboard is unavailable', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    generateReport(RICH_STATE);

    fireEvent.click(screen.getByTestId('copy-report'));
    await waitFor(() => expect(screen.getByText('Copy failed')).toBeInTheDocument());
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument();
  });

  it('returns the label to idle after the feedback window', async () => {
    jest.useFakeTimers();
    try {
      stubClipboard(() => Promise.resolve());
      generateReport(RICH_STATE);

      fireEvent.click(screen.getByTestId('copy-report'));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText('Copied!')).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(2500);
      });
      expect(screen.getByText('Copy report')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('downloads the .txt variant when Download .txt is clicked', () => {
    generateReport(RICH_STATE);

    const revokeSpy = jest.fn();
    URL.createObjectURL = jest.fn(() => 'blob:mock-txt') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeSpy as unknown as typeof URL.revokeObjectURL;
    let clicked: HTMLAnchorElement | null = null;
    // Capture the anchor from `this` inside the mock (no aliasing).
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked = this instanceof HTMLAnchorElement ? this : null;
      });

    fireEvent.click(screen.getByTestId('download-report-txt'));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clicked as unknown as HTMLAnchorElement;
    expect(anchor).not.toBeNull();
    expect(anchor.download).toMatch(/^car-purchase-intelligence-report-\d{4}-\d{2}-\d{2}(-[a-z0-9-]+)?\.txt$/);
    expect(anchor.href).toBe('blob:mock-txt');
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-txt');

    clickSpy.mockRestore();
  });

  it('renders the side-by-side comparison table from the saved specs', () => {
    generateReport(RICH_STATE);
    expect(screen.getByRole('columnheader', { name: 'Spec' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Toyota Camry' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Subaru Outback' })).toBeInTheDocument();
    expect(screen.getByText('$28,595')).toBeInTheDocument();
    expect(screen.getByText('$32,495')).toBeInTheDocument();
    expect(screen.getByText('FWD')).toBeInTheDocument();
    expect(screen.getByText('AWD')).toBeInTheDocument();
  });

  it('marks the winning vehicle per metric row with a Best chip', () => {
    generateReport(RICH_STATE);
    // Camry wins both metric rows (lowest MSRP, highest MPG) — exactly two
    // chips; the other rows get none.
    expect(screen.getAllByText('Best')).toHaveLength(2);
  });

  it('names the download files after the compared vehicles', () => {
    jest.useFakeTimers({ now: FIXED_NOW });
    // RICH_STATE has comparing: ['camry', 'outback'] without saved names —
    // the ids pass through as slugs when they are not pure-numeric.
    generateReport(RICH_STATE);

    const revokeSpy = jest.fn();
    URL.createObjectURL = jest.fn(() => 'blob:mock-named') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeSpy as unknown as typeof URL.revokeObjectURL;
    let clicked: HTMLAnchorElement | null = null;
    // Capture the anchor from `this` inside the mock (no aliasing).
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked = this instanceof HTMLAnchorElement ? this : null;
      });

    fireEvent.click(screen.getByTestId('download-report'));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clicked as unknown as HTMLAnchorElement;
    jest.useRealTimers();

    const expectedDate = FIXED_NOW.toISOString().slice(0, 10);
    expect(anchor.download).toBe(
      `car-purchase-intelligence-report-${expectedDate}-toyota-camry-subaru-outback.md`,
    );
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-named');

    clickSpy.mockRestore();

  });

  it('confirm clears the report marker, resets the view, and notifies the parent', () => {
    window.localStorage.setItem('freebuff-car-advisor-report-v1', JSON.stringify({ savedAt: 'x' }));
    const onReset = jest.fn();
    // Pre-set marker → the component restores straight into the generated view.
    render(<IntelligenceReport advisor={RICH_STATE} onReset={onReset} />);
    fireEvent.click(screen.getByTestId('start-over'));
    fireEvent.click(screen.getByTestId('reset-confirm-yes'));
    // Report marker gone; back at the consent gate, not the report.
    expect(window.localStorage.getItem('freebuff-car-advisor-report-v1')).toBeNull();
    expect(screen.getByRole('button', { name: /generate report/i })).toBeInTheDocument();
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe('estimated payment row on screen', () => {
  it('shows the payment row first in the comparison table, from Step 1 inputs', () => {
    generateReport(RICH_STATE);
    expect(screen.getByText('Est. monthly payment')).toBeInTheDocument();
    expect(screen.getByText('$514/mo')).toBeInTheDocument();
    expect(screen.getByText('$598/mo')).toBeInTheDocument();
    // Never carries a Best chip: it echoes MSRP, it is not an independent metric.
    const row = screen.getByText('Est. monthly payment').closest('tr');
    expect(row?.textContent).not.toContain('Best');
  });
});
