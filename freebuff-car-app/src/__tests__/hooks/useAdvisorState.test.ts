import { renderHook, act } from '@testing-library/react';
import { useAdvisorState } from '@/hooks/useAdvisorState';

describe('useAdvisorState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts at step 1 when no saved state exists', () => {
    const { result } = renderHook(() => useAdvisorState());
    expect(result.current.state.step).toBe(1);
    expect(result.current.hydrated).toBe(true);
  });

  it('persists state updates to localStorage', () => {
    const { result } = renderHook(() => useAdvisorState());
    act(() => {
      result.current.update({ step: 5, finance: { price: 30000 } });
    });
    const raw = window.localStorage.getItem('freebuff-car-advisor-state');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.step).toBe(5);
    expect(parsed.finance).toEqual({ price: 30000 });
  });

  it('restores a saved session from localStorage', () => {
    window.localStorage.setItem(
      'freebuff-car-advisor-state',
      JSON.stringify({ step: 7, trade: { value: 12000 } })
    );
    const { result } = renderHook(() => useAdvisorState());
    expect(result.current.state.step).toBe(7);
    expect(result.current.state.trade).toEqual({ value: 12000 });
  });

  it('falls back to defaults on corrupted storage', () => {
    window.localStorage.setItem('freebuff-car-advisor-state', 'not-json{');
    const { result } = renderHook(() => useAdvisorState());
    expect(result.current.state.step).toBe(1);
  });

  it('persists a NEW session started after a reset', () => {
    window.localStorage.setItem('freebuff-car-advisor-state', JSON.stringify({ step: 6 }));
    const { result } = renderHook(() => useAdvisorState());
    act(() => {
      result.current.reset();
    });
    expect(window.localStorage.getItem('freebuff-car-advisor-state')).toBeNull();
    act(() => {
      result.current.update({ step: 2, intake: { monthlyBudget: '4500' } });
    });
    const raw = window.localStorage.getItem('freebuff-car-advisor-state');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.step).toBe(2);
    expect(parsed.intake).toEqual({ monthlyBudget: '4500' });
  });

  it('reset clears storage and returns to step 1', () => {
    window.localStorage.setItem(
      'freebuff-car-advisor-state',
      JSON.stringify({ step: 4 })
    );
    const { result } = renderHook(() => useAdvisorState());
    act(() => {
      result.current.reset();
    });
    expect(result.current.state.step).toBe(1);
    expect(window.localStorage.getItem('freebuff-car-advisor-state')).toBeNull();
  });
});
