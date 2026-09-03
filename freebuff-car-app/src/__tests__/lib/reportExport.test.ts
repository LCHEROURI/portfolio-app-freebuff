import { buildReportMarkdown, buildReportPlainText, reportFileName } from '@/lib/reportExport';
import type { AdvisorState } from '@/hooks/useAdvisorState';

const RICH: AdvisorState = {
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

describe('reportFileName extensions', () => {
  it('uses .txt when requested', () => {
    expect(reportFileName('2026-09-03T12:00:00Z', 'txt')).toBe('car-purchase-intelligence-report-2026-09-03.txt');
    expect(reportFileName('2026-09-03T12:00:00Z', 'md')).toBe('car-purchase-intelligence-report-2026-09-03.md');
  });
});

describe('reportFileName vehicle names', () => {
  it('appends slugs of the compared vehicles when names are saved', () => {
    const advisor: AdvisorState = {
      step: 2,
      vehicles: {
        needs: {},
        comparing: ['camry', 'outback'],
        names: { camry: 'Toyota Camry', outback: 'Subaru Outback' },
      },
    };
    expect(reportFileName('2026-09-03T12:00:00Z', 'md', advisor)).toBe(
      'car-purchase-intelligence-report-2026-09-03-toyota-camry-subaru-outback.md',
    );
  });

  it('falls back to the raw id when no name is saved', () => {
    const advisor: AdvisorState = {
      step: 2,
      vehicles: { needs: {}, comparing: ['mc-12345'] },
    };
    // Pure-numeric live-feed ids are skipped; alphanumeric ids pass through.
    expect(reportFileName('2026-09-03T12:00:00Z', 'md', advisor)).toBe(
      'car-purchase-intelligence-report-2026-09-03-mc-12345.md',
    );
  });

  it('omits pure-numeric live-feed ids that carry no name', () => {
    const advisor: AdvisorState = {
      step: 2,
      vehicles: { needs: {}, comparing: ['12345'] },
    };
    expect(reportFileName('2026-09-03T12:00:00Z', 'md', advisor)).toBe(
      'car-purchase-intelligence-report-2026-09-03.md',
    );
  });

  it('falls back to the dated filename with an empty comparison set', () => {
    const advisor: AdvisorState = { step: 2, vehicles: { needs: {}, comparing: [] } };
    expect(reportFileName('2026-09-03T12:00:00Z', 'md', advisor)).toBe(
      'car-purchase-intelligence-report-2026-09-03.md',
    );
  });

  it('tolerates a missing advisor payload entirely', () => {
    expect(reportFileName('2026-09-03T12:00:00Z', 'md', null)).toBe(
      'car-purchase-intelligence-report-2026-09-03.md',
    );
  });

  it('sanitizes names with spaces and symbols into a filesafe slug', () => {
    const advisor: AdvisorState = {
      step: 2,
      vehicles: { needs: {}, comparing: ['rav4'], names: { rav4: 'Toyota RAV4 XLE / Hybrid!!' } },
    };
    expect(reportFileName('2026-09-03T12:00:00Z', 'txt', advisor)).toBe(
      'car-purchase-intelligence-report-2026-09-03-toyota-rav4-xle-hybrid.txt',
    );
  });

  it('caps the slug list at the three-vehicle compare limit', () => {
    const advisor: AdvisorState = {
      step: 2,
      vehicles: {
        needs: {},
        comparing: ['a', 'b', 'c', 'd'],
        names: { a: 'Alpha', b: 'Bravo', c: 'Charlie', d: 'Delta' },
      },
    };
    const name = reportFileName('2026-09-03T12:00:00Z', 'md', advisor);
    expect(name).toBe('car-purchase-intelligence-report-2026-09-03-alpha-bravo-charlie.md');
  });
});

describe('side-by-side comparison in exports', () => {
  it('includes a Markdown comparison table with both vehicles specs', () => {
    const md = buildReportMarkdown(RICH, '2026-09-03T12:00:00Z');
    expect(md).toContain('## Side-by-side comparison');
    expect(md).toContain('| Spec | Toyota Camry | Subaru Outback |');
    expect(md).toContain('| MSRP | $28,595 | $32,495 |');
    expect(md).toContain('| MPG combined | 33 | 29 |');
    expect(md).toContain('| Seating | 5 seats | 5 seats |');
    expect(md).toContain('| Drivetrain | FWD | AWD |');
    expect(md).toContain('| Safety | IIHS Top Safety Pick+ | IIHS Top Safety Pick+ |');
  });

  it('includes the same comparison as aligned plain text', () => {
    const txt = buildReportPlainText(RICH, '2026-09-03T12:00:00Z');
    expect(txt).toContain('SIDE-BY-SIDE COMPARISON');
    expect(txt).toContain('Toyota Camry');
    expect(txt).toContain('MSRP');
    expect(txt).toContain('$28,595');
    expect(txt).toContain('$32,495');
    expect(txt).toContain('FWD');
    expect(txt).toContain('AWD');
    // Plain text carries no Markdown table pipes.
    expect(txt).not.toContain('| Spec |');
  });

  it('omits the section entirely when no comparison set is saved', () => {
    const empty: AdvisorState = { step: 11, vehicles: { needs: {} } };
    expect(buildReportMarkdown(empty, null)).not.toContain('Side-by-side comparison');
    expect(buildReportPlainText(empty, null)).not.toContain('SIDE-BY-SIDE COMPARISON');
  });

  it('renders vehicles without saved specs as all-n/a columns (old sessions)', () => {
    const legacy: AdvisorState = {
      step: 2,
      vehicles: { needs: {}, comparing: ['camry'], names: { camry: 'Toyota Camry' } },
    };
    const md = buildReportMarkdown(legacy, '2026-09-03T12:00:00Z');
    expect(md).toContain('| MSRP | n/a |');
    expect(md).toContain('| MPG combined | n/a |');
    expect(md).toContain('| Safety | n/a |');
  });

  it('keeps the mp/md parity contract across the comparison rows', () => {
    const md = buildReportMarkdown(RICH, '2026-09-03T12:00:00Z');
    const txt = buildReportPlainText(RICH, '2026-09-03T12:00:00Z');
    for (const value of ['$28,595', '$32,495', 'FWD', 'AWD']) {
      expect(md).toContain(value);
      expect(txt).toContain(value);
    }
  });
});

describe('buildReportPlainText', () => {
  it('renders the same session data without Markdown syntax', () => {
    const txt = buildReportPlainText(RICH, '2026-09-03T12:00:00Z');
    expect(txt).toContain('CAR PURCHASE INTELLIGENCE REPORT');
    expect(txt).toContain('YOUR BUDGET');
    expect(txt).toContain('* Monthly budget: $4,500');
    expect(txt).toContain('* Monthly payment: $522 — fits within your monthly budget.');
    expect(txt).toContain('72 / 100');
    expect(txt).toContain('* Negotiate the out-the-door price first');
    // No Markdown-specific syntax should leak into the .txt.
    expect(txt).not.toMatch(/^#/m);
    expect(txt).not.toMatch(/\*\*/);
  });

  it('marks uncompleted steps explicitly', () => {
    const txt = buildReportPlainText({ step: 11 }, null);
    expect(txt).toContain('>> Step 1 not completed yet.');
    expect(txt).toContain('>> Step 3 not completed yet.');
    expect(txt).toContain('>> Step 10 not completed yet.');
  });

  it('matches the Markdown export on every data line', () => {
    const md = buildReportMarkdown(RICH, null);
    const txt = buildReportPlainText(RICH, null);
    // The generated-at header is excluded: each builder timestamps itself,
    // and the Markdown form wraps the line in emphasis syntax.
    const dataLines = (s: string) =>
      s.split('\n')
        .map((l) => l.replace(/^(#|>|-|\*)+\s*/, '').replace(/\*\*/g, '').replace(/_/g, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
        .filter((l) => l.length > 0 && !l.startsWith('===') && !l.startsWith('---') && !l.includes('generated by'));
    const mdData = new Set(dataLines(md));
    for (const line of dataLines(txt)) {
      expect(mdData.has(line)).toBe(true);
    }
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
