'use client';

import { useEffect, useRef, useState } from 'react';

import { fetchIntegrationStatus, type IntegrationStatus } from '@/lib/liveData';

// ============================================================================
// Shared /api/status polling hook — used by the Integrations panel (30s) and
// the sidebar connection-status widget (60s) so both surfaces never drift.
// The server caches pings for 2 minutes, so polling never re-hits provider
// APIs; refresh() bypasses that cache with ?refresh=1.
// ============================================================================

export interface UseIntegrationStatus {
  statuses: IntegrationStatus[] | null;
  checkedAt: string | null;
  error: string | null;
  loading: boolean;
  /** Force a fresh check, bypassing the server-side ping cache. */
  refresh: () => void;
}

export const useIntegrationStatus = (userId: string, pollMs: number): UseIntegrationStatus => {
  const [statuses, setStatuses] = useState<IntegrationStatus[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // One-shot flag consumed by the next run: a manual refresh bypasses the
  // server's per-check ping cache (?refresh=1).
  const forceRefresh = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      setLoading(true);
      try {
        const res = await fetchIntegrationStatus(userId, forceRefresh.current);
        if (cancelled) return;
        setStatuses(res.integrations);
        setCheckedAt(res.checkedAt);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to check integrations.');
      } finally {
        // Consume the one-shot refresh flag on success OR failure so a failed
        // manual refresh doesn't keep forcing fresh pings on later polls.
        forceRefresh.current = false;
        if (!cancelled) {
          setLoading(false);
          // Best-effort pause while the tab is hidden: don't schedule the next
          // poll when hidden; onVisible below reschedules on return. A timer
          // already scheduled while visible may still fire if the tab hides
          // before it elapses — acceptable for a status poll.
          if (document.visibilityState === 'visible') timer = setTimeout(run, pollMs);
        }
      }
    };
    run();

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, pollMs);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, pollMs, refreshKey]);

  const refresh = () => {
    forceRefresh.current = true;
    setRefreshKey((k) => k + 1);
  };

  return { statuses, checkedAt, error, loading, refresh };
};
