import { useState, useEffect, useCallback } from 'react';

export const STORAGE_KEY = 'freebuff-car-advisor-state';

export interface AdvisorState {
  step: number;
  /** Furthest step ever reached — unlike `step`, it never moves backward. */
  maxStep?: number;
  intake?: Record<string, unknown>;
  priorities?: Record<string, unknown>;
  vehicles?: Record<string, unknown>;
  finance?: Record<string, unknown>;
  lease?: Record<string, unknown>;
  ownership?: Record<string, unknown>;
  trade?: Record<string, unknown>;
  fees?: Record<string, unknown>;
  dealScore?: Record<string, unknown>;
  consent?: boolean;
}

const DEFAULT_STATE: AdvisorState = { step: 1 };

export function useAdvisorState() {
  const [state, setState] = useState<AdvisorState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AdvisorState;
        if (parsed && typeof parsed.step === 'number') {
          setState(parsed);
        }
      }
    } catch {
      // corrupted or unavailable storage: start fresh
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || cleared) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full or unavailable: ignore
    }
  }, [state, hydrated, cleared]);

  const update = useCallback((patch: Partial<AdvisorState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setState(DEFAULT_STATE);
    setCleared(true);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { state, update, reset, hydrated };
}
