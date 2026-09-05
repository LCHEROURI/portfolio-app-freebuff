import {
  estimateMonthlyPayment,
  maxPriceForBudget,
  maxPrincipalForPayment,
  monthlyPayment,
  APR_BY_CREDIT,
  FEE_HEADROOM_FACTOR,
} from '@/lib/affordability';

describe('maxPrincipalForPayment', () => {
  it('inverts the amortized payment exactly', () => {
    // Round-trip: principal -> payment -> principal must land back.
    const principal = 27000;
    const payment = monthlyPayment(principal, 6, 60);
    expect(maxPrincipalForPayment(payment, 6, 60)).toBeCloseTo(principal, 4);
  });

  it('handles 0% APR as simple multiplication', () => {
    expect(maxPrincipalForPayment(500, 0, 60)).toBe(30000);
  });

  it('returns 0 for non-positive payment', () => {
    expect(maxPrincipalForPayment(0, 6, 60)).toBe(0);
  });
});

describe('maxPriceForBudget', () => {
  it('caps the price so the amortized payment fits the budget', () => {
    // Ceiling is computed at 'good' credit (6.5% APR). The payment on the
    // resulting price (plus fees) must not exceed the monthly budget.
    const result = maxPriceForBudget({ monthlyBudget: 500, downPayment: 5000, creditRange: 'good' });
    expect(result).not.toBeNull();
    const price = result as number;

    // Price + ~9.4% fees - down payment = financed principal.
    const principal = (price * (1 + FEE_HEADROOM_FACTOR)) - 5000;
    const payment = monthlyPayment(principal, APR_BY_CREDIT.good, 60);
    expect(payment).toBeLessThanOrEqual(500);
    // And it should be close to the budget (not wildly conservative).
    expect(payment).toBeGreaterThan(450);
  });

  it('rounds down to the nearest $100', () => {
    const result = maxPriceForBudget({
      monthlyBudget: 500, downPayment: 5000, creditRange: 'good', aprOverride: 6,
    });
    expect(result).not.toBeNull();
    expect((result as number) % 100).toBe(0);
  });

  it('a larger down payment raises the ceiling', () => {
    const low = maxPriceForBudget({ monthlyBudget: 500, downPayment: 2000, creditRange: 'good' });
    const high = maxPriceForBudget({ monthlyBudget: 500, downPayment: 10000, creditRange: 'good' });
    expect((high as number) - (low as number)).toBeGreaterThanOrEqual(7000);
  });

  it('worse credit lowers the ceiling', () => {
    const excellent = maxPriceForBudget({ monthlyBudget: 500, downPayment: 5000, creditRange: 'excellent' });
    const poor = maxPriceForBudget({ monthlyBudget: 500, downPayment: 5000, creditRange: 'poor' });
    expect((poor as number)).toBeLessThan(excellent as number);
  });

  it('falls back to the good-credit APR for an unknown tier', () => {
    const withTier = maxPriceForBudget({ monthlyBudget: 500, downPayment: 5000, creditRange: 'good', aprOverride: APR_BY_CREDIT.good });
    const unknown = maxPriceForBudget({ monthlyBudget: 500, downPayment: 5000, creditRange: 'nope' });
    expect(unknown).toBe(withTier);
  });

  it('returns null for a non-positive budget', () => {
    expect(maxPriceForBudget({ monthlyBudget: 0, downPayment: 5000, creditRange: 'good' })).toBeNull();
    expect(maxPriceForBudget({ monthlyBudget: -100, downPayment: 0, creditRange: 'good' })).toBeNull();
  });

  it('returns null when the ceiling rounds below $100 (tiny budget)', () => {
    // $2/mo x 60 = $120 principal -> price ~$110 -> floors to 0.
    expect(maxPriceForBudget({ monthlyBudget: 2, downPayment: 0, creditRange: 'good', aprOverride: 6 })).toBeNull();
  });
});

describe('estimateMonthlyPayment', () => {
  it('prices the sample fleet exactly (good credit, $5,000 down)', () => {
    expect(estimateMonthlyPayment({ price: 28595, downPayment: 5000, creditRange: 'good' })).toBe(514);
    expect(estimateMonthlyPayment({ price: 32495, downPayment: 5000, creditRange: 'good' })).toBe(598);
  });

  it('moves with the credit tier (better credit, lower payment)', () => {
    expect(estimateMonthlyPayment({ price: 28595, downPayment: 5000, creditRange: 'excellent' })).toBe(496);
    const excellent = estimateMonthlyPayment({ price: 28595, downPayment: 5000, creditRange: 'excellent' });
    const poor = estimateMonthlyPayment({ price: 28595, downPayment: 5000, creditRange: 'poor' });
    expect((poor as number)).toBeGreaterThan(excellent as number);
  });

  it('round-trips against maxPriceForBudget: the ceiling prices back to the budget', () => {
    for (const monthlyBudget of [500, 750]) {
      const ceiling = maxPriceForBudget({ monthlyBudget, downPayment: 5000, creditRange: 'good' });
      expect(ceiling).not.toBeNull();
      const payment = estimateMonthlyPayment({ price: ceiling as number, downPayment: 5000, creditRange: 'good' });
      expect(payment).not.toBeNull();
      // Within one rounding dollar of the budget — the two functions are inverses.
      expect(Math.abs((payment as number) - monthlyBudget)).toBeLessThanOrEqual(1);
    }
  });

  it('is honest when there is nothing to finance', () => {
    expect(estimateMonthlyPayment({ price: 0, downPayment: 0, creditRange: 'good' })).toBeNull();
    expect(estimateMonthlyPayment({ price: -500, downPayment: 0, creditRange: 'good' })).toBeNull();
    expect(estimateMonthlyPayment({ price: 3000, downPayment: 3000, creditRange: 'good' })).toBeNull();
    expect(estimateMonthlyPayment({ price: 3000, downPayment: 5000, creditRange: 'good' })).toBeNull();
    expect(estimateMonthlyPayment({ price: NaN, downPayment: 0, creditRange: 'good' })).toBeNull();
  });

  it('treats a missing down payment as zero', () => {
    const withZero = estimateMonthlyPayment({ price: 28595, downPayment: 0, creditRange: 'good' });
    const withEmpty = estimateMonthlyPayment({ price: 28595, downPayment: -400, creditRange: 'good' });
    expect(withEmpty).toBe(withZero);
  });
});
