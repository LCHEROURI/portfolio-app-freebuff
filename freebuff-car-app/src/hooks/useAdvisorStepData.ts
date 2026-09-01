import { useCallback } from 'react';
import { useAdvisorState, type AdvisorState } from './useAdvisorState';

/**
 * Extends useAdvisorState with per-step form data persistence.
 * Each step component receives a `saveStepData(stepKey, data)` callback and
 * calls it right before `onComplete()`, so the whole advisor session
 * (not just the step number) survives a page refresh.
 */
export function useAdvisorStepData() {
  const { state, update, reset, hydrated } = useAdvisorState();

  const saveStepData = useCallback(
    (stepKey: keyof Omit<AdvisorState, 'step' | 'consent'>, data: unknown) => {
      update({ [stepKey]: data } as Partial<AdvisorState>);
    },
    [update]
  );

  return { state, saveStepData, update, reset, hydrated };
}
