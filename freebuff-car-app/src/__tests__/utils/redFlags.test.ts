import {
  docFeeFlags,
  addOnFlags,
  quoteRedFlags,
  HIGHLAND_ADD_ONS,
} from '@/utils/redFlags';

describe('docFeeFlags', () => {
  it('flags a doc fee above the $150 threshold', () => {
    const flags = docFeeFlags(200);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe('docFee');
    expect(flags[0].label).toContain('$150');
    expect(flags[0].value).toBe(200);
    expect(flags[0].threshold).toBe(150);
  });

  it('does not flag a doc fee at or below the threshold', () => {
    expect(docFeeFlags(150)).toHaveLength(0);
    expect(docFeeFlags(100)).toHaveLength(0);
    expect(docFeeFlags(0)).toHaveLength(0);
  });
});

describe('addOnFlags', () => {
  it('flags known high-margin add-ons', () => {
    const flags = addOnFlags([
      'Paint and Fabric Protection',
      'Nitrogen Tires',
      'Glass Etching',
    ]);
    expect(flags).toHaveLength(3);
    expect(flags[0].label).toContain('paint and fabric protection');
    expect(flags[1].label).toContain('nitrogen tires');
    expect(flags[2].label).toContain('glass etching');
  });

  it('handles empty input', () => {
    expect(addOnFlags([])).toHaveLength(0);
    expect(addOnFlags([''])).toHaveLength(0);
  });

  it('does not flag benign items', () => {
    const flags = addOnFlags([
      'Extended warranty',
      'Gap insurance',
      'Tires',
    ]);
    // These are not in the hardcoded high-margin add-on list, so no flags.
    expect(flags).toHaveLength(0);
  });

  it('is case-insensitive and trims input', () => {
    const flags = addOnFlags(['  paint protection  ']);
    expect(flags).toHaveLength(1);
    expect(flags[0].label).toContain('paint protection');
  });
});

describe('quoteRedFlags', () => {
  it('combines doc fee and add-on flags', () => {
    const flags = quoteRedFlags(250, ['Fabric Protection']);
    expect(flags).toHaveLength(2);
    expect(flags[0].type).toBe('docFee');
    expect(flags[1].type).toBe('addOn');
  });

  it('returns no flags for a clean quote', () => {
    const flags = quoteRedFlags(100, []);
    expect(flags).toHaveLength(0);
  });
});

describe('HIGHLAND_ADD_ONS constant', () => {
  it('contains the expected high-margin add-on patterns', () => {
    expect(HIGHLAND_ADD_ONS).toContain('paint and fabric protection');
    expect(HIGHLAND_ADD_ONS).toContain('nitrogen tires');
    expect(HIGHLAND_ADD_ONS).toContain('glass etching');
  });
});
