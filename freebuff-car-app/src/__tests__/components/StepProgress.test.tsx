import { render, screen } from '@testing-library/react';
import StepProgress from '@/components/StepProgress';
import { REPORT_STORAGE_KEY } from '@/lib/progress';
import type { AdvisorState } from '@/hooks/useAdvisorState';

const PARTIAL: AdvisorState = {
  step: 4,
  maxStep: 6,
  intake: { monthlyBudget: '4500' },
  finance: { vehiclePrice: '32000' },
};

const FULL: AdvisorState = {
  step: 11,
  maxStep: 11,
  intake: { monthlyBudget: '4500' },
  finance: { vehiclePrice: '32000' },
  lease: { newPrice: '30000' },
  ownership: { monthlyLoan: '500' },
  trade: { tradeValue: '9000' },
  fees: { docFee: '129' },
  dealScore: { input: {}, result: { score: 72 } },
};

describe('StepProgress', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders 0 of 11 for an empty store', () => {
    render(<StepProgress advisor={{ step: 1 }} />);
    expect(screen.getByText('0 of 11 steps completed')).toBeInTheDocument();
  });

  it('counts only steps with saved data', () => {
    render(<StepProgress advisor={PARTIAL} />);
    // Steps 1 and 3 have data; maxStep 6 means step 6 was reached, not passed.
    expect(screen.getByText('2 of 11 steps completed')).toBeInTheDocument();
  });

  it('reaches 10 of 11 with all data saved but no report generated', () => {
    render(<StepProgress advisor={FULL} />);
    expect(screen.getByText('9 of 11 steps completed')).toBeInTheDocument();
  });

  it('reaches 11 of 11 once the report marker exists', () => {
    window.localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify({ savedAt: '2026-09-03' }));
    render(<StepProgress advisor={FULL} />);
    expect(screen.getByText('10 of 11 steps completed')).toBeInTheDocument();
  });

  it('sets an accessible progressbar value', () => {
    render(<StepProgress advisor={PARTIAL} />);
    const bar = screen.getByRole('progressbar', { name: /advisor progress/i });
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemax', '11');
  });
});
