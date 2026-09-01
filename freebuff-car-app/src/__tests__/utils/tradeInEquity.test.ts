import {
  tradeInEquity,
  isUpsideDown,
  tradePosition,
} from '@/utils/tradeInEquity';

describe('tradeInEquity', () => {
  it('computes positive equity', () => {
    expect(tradeInEquity(15000, 10000)).toBe(5000);
  });

  it('computes zero equity', () => {
    expect(tradeInEquity(12000, 12000)).toBe(0);
  });

  it('computes negative equity', () => {
    expect(tradeInEquity(10000, 12500)).toBe(-2500);
  });

  it('handles zero payoff', () => {
    expect(tradeInEquity(8000, 0)).toBe(8000);
  });
});

describe('isUpsideDown', () => {
  it('returns false for positive equity', () => {
    expect(isUpsideDown(15000, 10000)).toBe(false);
  });

  it('returns false for zero equity', () => {
    expect(isUpsideDown(12000, 12000)).toBe(false);
  });

  it('returns true for negative equity', () => {
    expect(isUpsideDown(10000, 12500)).toBe(true);
  });
});

describe('tradePosition', () => {
  it('returns "positive" for clear positive equity', () => {
    expect(tradePosition(15000, 10000)).toBe('positive');
  });

  it('returns "even" within tolerance', () => {
    expect(tradePosition(12000, 12000)).toBe('even');
    expect(tradePosition(12000, 12000.5)).toBe('even');
    expect(tradePosition(12000, 11999.5)).toBe('even');
  });

  it('returns "negative" for clear negative equity', () => {
    expect(tradePosition(10000, 12500)).toBe('negative');
  });

  it('honors a custom tolerance', () => {
    expect(tradePosition(12000, 12020, 25)).toBe('even');
    expect(tradePosition(12000, 12020, 10)).toBe('negative');
  });
});
