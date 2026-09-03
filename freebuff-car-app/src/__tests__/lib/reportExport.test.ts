import { buildReportMarkdown, reportFileName } from '@/lib/reportExport';
import type { AdvisorState } from '@/hooks/useAdvisorState';

const RICH: AdvisorState = {
  step: 11,
  intake: { monthlyBudget: '4500', downPayment: '5000', creditRange: 'good' },
  finance: { vehiclePrice: '32000', downPayment: '5000', apr: '6', termMonths: '60' },
  trade: { tradeValue: '12000', payoff: '9000' },
  fees: { docFee: '299', titleRegistration: '345', addOnsText: 'Fabric Protection, Nitrogen Tires' },
  ownership: { monthlyLoan: '500', insurance: '120', fuel: '150', maintenance: '75', registration: '30', parking: '0', taxesAndFees: '40', other: '0' },
  vehicles: { needs: { awd: true, appleCarPlay: true }, comparing: ['camry', 'outback'] },
  dealScore: { input: {}, result: { score: 72, breakdown: [{ label: 'Financing affordability', points: 25, maxPoints: 25, earned: 25, reason: 'fits' }] } },
};

describe('reportFileName', () => {
  it('uses the saved date in the filename', () => {
    expect(reportFileName('2026-09-03T12:00:00Z')).toBe('car-purchase-intelligence-report-2026-09-03.md');
  });

  it('falls back to today without a savedAt', () => {
    expect(reportFileName(null)).toMatch(/^car-purchase-intelligence-report-\d{4}-\d{2}-\d{2}\.md$/);
  });
});

describe('buildReportMarkdown', () => {
  it('renders every section from the saved session', () => {
    const md = buildReportMarkdown(RICH, '2026-09-03T12:00:00Z');
    expect(md).toContain('# Car Purchase Intelligence Report');
    expect(md).toContain('- Monthly budget: $4,500');
    // Financing computed live: 27000 @ 6% / 60mo = $522 (521.99)
    expect(md).toContain('- Monthly payment: $522 — fits within your monthly budget.');
    expect(md).toContain('- Total cost of loan: $31,319');
    expect(md).toContain('- Equity: +$3,000');
    expect(md).toContain('- Documentation fee: $299');
    expect(md).toContain('- High-margin add-on detected: "fabric protection"');
    expect(md).toContain('- Estimated total per month: $915');
    expect(md).toContain('- All-wheel drive');
    expect(md).toContain('**72 / 100**');
    expect(md).toContain('- Negotiate the out-the-door price first');
  });

  it('marks uncompleted steps explicitly', () => {
    const md = buildReportMarkdown({ step: 11 }, null);
    expect(md).toContain('> Step 1 not completed yet.');
    expect(md).toContain('> Step 3 not completed yet.');
    expect(md).toContain('> Step 10 not completed yet.');
  });

  it('flags over-budget payments', () => {
    const over: AdvisorState = { ...RICH, intake: { monthlyBudget: '300' } };
    const md = buildReportMarkdown(over, null);
    expect(md).toContain('OVER your monthly budget');
  });

  it('flags negative equity', () => {
    const underwater: AdvisorState = { ...RICH, trade: { tradeValue: '8000', payoff: '11000' } };
    const md = buildReportMarkdown(underwater, null);
    expect(md).toContain('negative equity');
  });

  it('matches the rendered report on the money numbers', () => {
    // The on-screen test asserts the same figures — this is the contract:
    // file and screen can never disagree.
    const md = buildReportMarkdown(RICH, null);
    expect(md).toContain('$522');
    expect(md).toContain('+$3,000'.replace('+$', '+$')); // sanity
    expect(md).toContain('$915');
    expect(md).toContain('$299');
  });
});
