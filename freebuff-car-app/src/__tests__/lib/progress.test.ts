import { completedStepSet, completedStepCount } from '@/lib/progress';
import type { AdvisorState } from '@/hooks/useAdvisorState';

const s = (over: Partial<AdvisorState> = {}): AdvisorState => ({ step: 1, ...over });

describe('completedStepSet', () => {
  it('counts zero steps for an empty store', () => {
    expect(completedStepCount(s())).toBe(0);
  });

  it('counts steps with saved data payloads', () => {
    const state = s({
      intake: { monthlyBudget: '4500' },
      finance: { vehiclePrice: '32000' },
      trade: { tradeValue: '9000' },
      dealScore: { input: {}, result: { score: 72 } },
    });
    expect(completedStepSet(state)).toEqual(new Set([1, 3, 7, 10]));
  });

  it('counts step 2 when a need is checked or a vehicle is compared', () => {
    expect(completedStepSet(s({ vehicles: { needs: { awd: true } } })).has(2)).toBe(true);
    expect(completedStepSet(s({ vehicles: { needs: { awd: false } }, step: 3 })).has(2)).toBe(false);
    expect(completedStepSet(s({ vehicles: { comparing: ['camry'] } })).has(2)).toBe(true);
  });

  it('does not count step 2 for empty needs with no comparisons', () => {
    expect(completedStepSet(s({ vehicles: { needs: {}, comparing: [] } })).has(2)).toBe(false);
  });

  it('counts moved-past steps 6 and 9 via monotonic maxStep', () => {
    const state = s({ step: 4, maxStep: 10 }); // user navigated back to 4
    const done = completedStepSet(state);
    expect(done.has(6)).toBe(true);
    expect(done.has(9)).toBe(true);
  });

  it('does not count moved-past steps when maxStep has not passed them', () => {
    const state = s({ step: 4, maxStep: 4 });
    const done = completedStepSet(state);
    expect(done.has(6)).toBe(false);
    expect(done.has(9)).toBe(false);
  });

  it('falls back to step when maxStep is absent (old stored sessions)', () => {
    const state = s({ step: 8 });
    const done = completedStepSet(state);
    expect(done.has(6)).toBe(true);
    expect(done.has(9)).toBe(false);
  });

  it('does not count step 11 until the report is generated', () => {
    const state = s({ maxStep: 11 });
    expect(completedStepSet(state).has(11)).toBe(false);
    expect(completedStepSet(state, true).has(11)).toBe(true);
  });

  it('does not count step 4 or 5 for an empty object', () => {
    const state = s({ lease: {}, ownership: {} });
    const done = completedStepSet(state);
    expect(done.has(4)).toBe(false);
    expect(done.has(5)).toBe(false);
  });

  it('ignores non-object payloads safely', () => {
    const state = { step: 1, intake: 'garbage', finance: 42 } as unknown as AdvisorState;
    expect(completedStepCount(state)).toBe(0);
  });
});
