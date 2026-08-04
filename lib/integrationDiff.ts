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

/** One integration's change summary: its id plus the fields that flipped. */
export interface IntegrationChange {
  id: string;
  changes: string[];
}

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
 * Human-readable "what changed" descriptions between two checks of the same
 * integration. Mirrors the same thresholds as `integrationChanged` so the
 * badge and its tooltip can never disagree about whether a change exists.
 * Returns [] when nothing observable changed (detail-string rewording is
 * intentionally ignored).
 */
export const describeIntegrationChange = (
  a: IntegrationStatus,
  b: IntegrationStatus,
): string[] => {
  const changes: string[] = [];

  if (a.configured !== b.configured) {
    changes.push(b.configured ? 'Now configured' : 'No longer configured');
  }
  if (a.enabled !== b.enabled) {
    changes.push(b.enabled ? 'Live flag turned on' : 'Live flag turned off');
  }

  // Env var (re)set, cleared, or added/removed. `prev !== undefined` (not a
  // truthiness check) keeps this in lockstep with `integrationChanged`, whose
  // fingerprint also differs when the set of var *names* changes.
  const envA = new Map(a.env.map((v) => [v.name, v]));
  for (const v of b.env) {
    const prev = envA.get(v.name);
    if (prev === undefined) {
      changes.push(v.set ? `${v.name} added` : `${v.name} present but unset`);
    } else if (prev.set !== v.set) {
      changes.push(v.set ? `${v.name} set` : `${v.name} cleared`);
    }
  }
  for (const v of a.env) {
    if (!b.env.some((w) => w.name === v.name)) changes.push(`${v.name} removed`);
  }

  // Endpoint flips: status code, reachability, latency spike.
  const ea = a.endpoint;
  const eb = b.endpoint;
  if (ea === null && eb !== null) {
    changes.push(`Endpoint now ${eb.ok ? 'responding' : 'erroring'}`);
  } else if (ea !== null && eb === null) {
    changes.push('Endpoint no longer reported');
  } else if (ea && eb) {
    if (ea.ok !== eb.ok) {
      changes.push(`Endpoint ${ea.ok ? 'OK' : 'error'} → ${eb.ok ? 'OK' : 'error'}`);
    }
    if (ea.status !== eb.status) {
      changes.push(ea.status === null || eb.status === null
        ? `Status now ${eb.status ?? 'unreachable'}`
        : `HTTP ${ea.status} → ${eb.status}`);
    }
    if ((ea.ms == null) !== (eb.ms == null)) {
      changes.push(eb.ms == null ? 'Latency no longer measured' : `Latency now ${eb.ms}ms`);
    } else if (
      ea.ms != null && eb.ms != null && Math.abs(ea.ms - eb.ms) >= LATENCY_SPIKE_MS
    ) {
      changes.push(`Latency ${ea.ms}ms → ${eb.ms}ms`);
    }
  }

  return changes;
};

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

/**
 * Change summaries (id + flipped fields) for integrations whose state differs
 * between two consecutive checks. Returns [] on the first check so nothing
 * badges on load. Powers the "Updated" badge tooltip on each affected card.
 */
export const computeChangedSummaries = (
  prev: IntegrationStatus[] | null,
  next: IntegrationStatus[],
): IntegrationChange[] => {
  if (!prev) return [];
  const byId = new Map(prev.map((s) => [s.id, s]));
  const summaries: IntegrationChange[] = [];
  for (const s of next) {
    const before = byId.get(s.id);
    if (!before) continue;
    const changes = describeIntegrationChange(before, s);
    if (changes.length > 0) summaries.push({ id: s.id, changes });
  }
  return summaries;
};
