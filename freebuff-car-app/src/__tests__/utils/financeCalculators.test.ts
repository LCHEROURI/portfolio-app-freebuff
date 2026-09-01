import {
  monthlyPayment,
  totalInterest,
  totalCost,
} from '@/utils/financeCalculators';

describe('monthlyPayment', () => {
  it('computes a standard amortized payment', () => {
    // $25,000 at 6% APR for 60 months.
    const payment = monthlyPayment(25000, 6, 60);
    // Expected: ~483.32. Allow small tolerance for floating point.
    expect(payment).toBeCloseTo(483.32, 2);
  });

  it('handles 0% APR without division by zero', () => {
    const payment = monthlyPayment(24000, 0, 48);
    expect(payment).toBe(500);
  });

  it('returns 0 for zero principal', () => {
    expect(monthlyPayment(0, 6, 60)).toBe(0);
  });

  it('returns 0 for zero term', () => {
    expect(monthlyPayment(25000, 6, 0)).toBe(0);
  });

  it('handles a longer term at low APR', () => {
    const payment = monthlyPayment(30000, 4.5, 72);
    // $30,000 at 4.5% APR for 72 months = ~$476.22
    expect(payment).toBeCloseTo(476.22, 2);
  });

  it('handles a high APR scenario', () => {
    const payment = monthlyPayment(20000, 12, 48);
    // $20,000 at 12% APR for 48 months = ~$526.68
    expect(payment).toBeCloseTo(526.68, 2);
  });
});

describe('totalInterest', () => {
  it('computes total interest over the loan life', () => {
    const interest = totalInterest(25000, 6, 60);
    // monthly ~483.32 * 60 - 25000 = ~3999.20
    expect(interest).toBeCloseTo(3999.20, 2);
  });

  it('returns 0 interest at 0% APR', () => {
    const interest = totalInterest(24000, 0, 48);
    expect(interest).toBe(0);
  });
});

describe('totalCost', () => {
  it('computes total cost of financing', () => {
    const cost = totalCost(25000, 6, 60);
    // 483.32 * 60 = ~28999.20
    expect(cost).toBeCloseTo(28999.20, 2);
  });

  it('equals principal at 0% APR', () => {
    const cost = totalCost(24000, 0, 48);
    expect(cost).toBe(24000);
  });
});
