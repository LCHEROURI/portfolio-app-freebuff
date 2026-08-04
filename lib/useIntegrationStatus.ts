'use client';

import { useEffect, useRef, useState } from 'react';

import { fetchIntegrationStatus, type IntegrationStatus } from '@/lib/liveData';
import { computeChangedIds } from '@/lib/integrationDiff';

// ============================================================================
// Shared /api/status polling hook — used by the Integrations panel (30s) and
// the sidebar connection-status widget (60s) so both surfaces never drift.
// The server caches pings for 2 minutes, so polling never re-hits provider
// APIs; refresh() bypasses that cache with ?refresh=1.
//
// Beyond the interval, the hook also polls *immediately* when the window or
// tab regains focus (visibilitychange + window focus). That makes setup
// feedback feel instant: paste the env lines, redeploy, switch back — the
// panel reflects the new state right away instead of waiting for the next
// interval tick.
// ============================================================================

export interface UseIntegrationStatus {
  statuses: IntegrationStatus[] | null;
  checkedAt: string | null;
  error: string | null;
  loading: boolean;
  /**
   * Ids of integrations whose state changed since the previous poll (env var
   * set, endpoint status flip, latency spike). Stays populated for a short
   * TTL so the panel can show an "Updated" badge, then clears itself.
   */
  changed: string[];
  /** Force a fresh check, bypassing the server-side ping cache. */
  refresh: () => void;
}

// How long the "Updated" badge stays visible after a detected change.
const CHANGED_BADGE_TTL_MS = 10_000;

// Skip an immediate focus-triggered poll if one just completed — browsers fire
// `focus` + `visibilitychange` together on tab return, and the window can also
// regain focus moments after a scheduled poll already ran. Within this window
// we keep the normal cadence instead of re-fetching.
const MIN_IMMEDIATE_GAP_MS = 2_000;

export const useIntegrationStatus = (userId: string, pollMs: number): UseIntegrationStatus => {
  const [statuses, setStatuses] = useState<IntegrationStatus[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [changed, setChanged] = useState<string[]>([]);
  // Snapshot of the last successful poll, used to diff the next one against.
  const prevStatusesRef = useRef<IntegrationStatus[] | null>(null);
  // Timer that clears the "Updated" badges after TTL. Stored so a later poll
  // (or unmount) can supersede it instead of stacking stale clears.
  const changedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // One-shot flag consumed by the next run: a manual refresh bypasses the
  // server's per-check ping cache (?refresh=1).
  const forceRefresh = useRef(false);
  // True while a fetch is in flight, so a focus event can't start a second
  // overlapping request — the running poll reschedules the interval itself.
  const runningRef = useRef(false);
  // Timestamp of the last completed poll — throttles focus-triggered polls.
  const lastRunAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      runningRef.current = true;
      setLoading(true);
      try {
        const res = await fetchIntegrationStatus(userId, forceRefresh.current);
        if (cancelled) return;
        setStatuses(res.integrations);
        setCheckedAt(res.checkedAt);
        setError(null);
        // Diff against the last successful poll and surface the changed ids.
        const diffIds = computeChangedIds(prevStatusesRef.current, res.integrations);
        prevStatusesRef.current = res.integrations;
        if (diffIds.length > 0) {
          // Union with any badges still within their TTL so a second poll in
          // the window doesn't drop an earlier card's badge prematurely. The
          // single timer re-arms per diff; all badges clear 10s after the
          // most recent one.
          setChanged((prev) => [...prev.filter((id) => !diffIds.includes(id)), ...diffIds]);
          if (changedTimerRef.current) clearTimeout(changedTimerRef.current);
          changedTimerRef.current = setTimeout(() => setChanged([]), CHANGED_BADGE_TTL_MS);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to check integrations.');
      } finally {
        // Consume the one-shot refresh flag on success OR failure so a failed
        // manual refresh doesn't keep forcing fresh pings on later polls.
        forceRefresh.current = false;
        // Only a run that wasn't torn down mid-flight resets the shared refs:
        // a cancelled (superseded by refreshKey) run must not clear the
        // runningRef set by its successor, nor count its discarded result
        // toward the focus-throttle gap.
        if (!cancelled) {
          runningRef.current = false;
          lastRunAtRef.current = Date.now();
          setLoading(false);
          // Best-effort pause while the tab is hidden: don't schedule the next
          // poll when hidden; pollNow below fires immediately on return. A timer
          // already scheduled while visible may still fire if the tab hides
          // before it elapses — acceptable for a status poll.
          if (document.visibilityState === 'visible') timer = setTimeout(run, pollMs);
        }
      }
    };
    run();

    // "Poll now": when the window or tab regains focus, check immediately so
    // setup feedback (env lines pasted, redeploy finished) appears instantly
    // instead of waiting for the next interval tick. Focused via both events
    // because `visibilitychange` covers tab switches while `window focus`
    // covers returning to the app window from another app.
    const pollNow = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (runningRef.current) return; // in-flight poll reschedules itself
      if (Date.now() - lastRunAtRef.current < MIN_IMMEDIATE_GAP_MS) {
        // A poll just completed (focus + visibilitychange both fire on tab
        // return) — keep the normal cadence rather than hammering.
        timer = setTimeout(run, pollMs);
        return;
      }
      run();
    };
    document.addEventListener('visibilitychange', pollNow);
    window.addEventListener('focus', pollNow);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (changedTimerRef.current) clearTimeout(changedTimerRef.current);
      document.removeEventListener('visibilitychange', pollNow);
      window.removeEventListener('focus', pollNow);
    };
  }, [userId, pollMs, refreshKey]);

  const refresh = () => {
    forceRefresh.current = true;
    setRefreshKey((k) => k + 1);
  };

  return { statuses, checkedAt, error, loading, changed, refresh };
};
