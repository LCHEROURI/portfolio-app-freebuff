import type { IntegrationStatus } from '@/lib/liveData';

// ============================================================================
// "Diff since last check" for the integration status panel.
//
// A change worth surfacing is one the user can act on or that explains a
// behavior flip: an env var (re)set, the live flag toggled, an endpoint
// status flip, or a latency spike. Small jitter (a few ms between re-pings,
// identical cached results) is ignored so the "Updated" badge only appears
// when a poll actually detected something new — which is what makes the
// focus-triggered polling visibly pay off.
//
// Note on latency spikes: the server caches successful pings for 120s, so
// consecutive 30s polls (and focus-triggered polls) diff against byte-
// identical `ms` values. The spike branch fires when the cache expires and
// a fresh ping differs, or on a manual Refresh (?refresh=1 clears the
// cache) — env-var and status flips, by contrast, register on every poll.
// ============================================================================

/** A latency jump of ≥1s (either direction) counts as a spike. */
export const LATENCY_SPIKE_MS = 1000;

const envFingerprint = (s: IntegrationStatus): string =>
  s.env.map((v) => `${v.name}:${v.set ? '1' : '0'}`).join('|');

const endpointChanged = (
  a: IntegrationStatus['endpoint'],
  b: IntegrationStatus['endpoint'],
): boolean => {
  if (a === null || b === null) return a !== b;
  if (a.ok !== b.ok) return true;
  if (a.status !== b.status) return true;
  // ms going null ↔ non-null is meaningful (e.g. a timeout starting/ending);
  // otherwise only a spike ≥ LATENCY_SPIKE_MS counts as a change.
  if ((a.ms == null) !== (b.ms == null)) return true;
  if (a.ms != null && b.ms != null && Math.abs(a.ms - b.ms) >= LATENCY_SPIKE_MS) return true;
  return false;
};

/** Whether an integration's observable state differs between two checks. */
export const integrationChanged = (a: IntegrationStatus, b: IntegrationStatus): boolean =>
  a.configured !== b.configured ||
  a.enabled !== b.enabled ||
  envFingerprint(a) !== envFingerprint(b) ||
  endpointChanged(a.endpoint, b.endpoint);

/**
 * Ids of integrations whose state differs between two consecutive checks.
 * Returns [] on the first check (prev === null) so nothing badges on load.
 */
export const computeChangedIds = (
  prev: IntegrationStatus[] | null,
  next: IntegrationStatus[],
): string[] => {
  if (!prev) return [];
  const byId = new Map(prev.map((s) => [s.id, s]));
  const changed: string[] = [];
  for (const s of next) {
    const before = byId.get(s.id);
    if (before && integrationChanged(before, s)) changed.push(s.id);
  }
  return changed;
};
