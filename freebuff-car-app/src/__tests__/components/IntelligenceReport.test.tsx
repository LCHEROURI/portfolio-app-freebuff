import { render, screen, fireEvent } from '@testing-library/react';
import IntelligenceReport from '@/components/advisor/IntelligenceReport';
import type { AdvisorState } from '@/hooks/useAdvisorState';

// A session store shaped like what the advisor flow saves across the steps.
const RICH_STATE: AdvisorState = {
  step: 11,
  intake: { monthlyBudget: '4500', downPayment: '5000', creditRange: 'good' },
  finance: { vehiclePrice: '32000', downPayment: '5000', apr: '6', termMonths: '60' },
  trade: { tradeValue: '12000', payoff: '9000' },
  fees: { docFee: '299', titleRegistration: '345', addOnsText: 'Fabric Protection, Nitrogen Tires' },
  ownership: { monthlyLoan: '500', insurance: '120', fuel: '150', maintenance: '75', registration: '30', parking: '0', taxesAndFees: '40', other: '0' },
  vehicles: { needs: { awd: true, appleCarPlay: true }, comparing: ['camry', 'outback'] },
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
    expect(screen.getByText(/monthly payment/i)).toBeInTheDocument();
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
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked = this;
      });

    fireEvent.click(screen.getByTestId('download-report'));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clicked as unknown as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^car-purchase-intelligence-report-\d{4}-\d{2}-\d{2}\.md$/);
    expect(anchor.href).toBe('blob:mock-url');
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url');

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
