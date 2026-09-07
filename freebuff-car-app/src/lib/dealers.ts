// Pure dealer locator for the advisor's contact sheet.
//
// No live dealers API is configured yet (like the inventory feed, the demo
// fallback keeps the flow working until a key exists), so this module serves
// DETERMINISTIC ZIP-seeded demo dealers: the same ZIP always yields the same
// five nearby dealers, and different ZIPs yield different ones. Everything is
// labeled demo in the UI — same honesty convention as the inventory banner.
// The `Dealer` shape is the contract a live dealers API would map into, so a
// later swap replaces `nearbyDealers` internals without touching the UI.
import type { AdvisorState } from '@/hooks/useAdvisorState';

export interface Dealer {
  /** Display name (e.g. "Gateway Motors"). */
  name: string;
  /** Street address, no city/ZIP (the ZIP is added to the directions URL). */
  address: string;
  /** Fictional (555) exchange — clearly not a real phone number. */
  phone: string;
  /** Approximate straight-line distance from the ZIP, miles. */
  distanceMi: number;
  /** Google Maps directions URL from the user's ZIP to this dealer. */
  directionsUrl: string;
}

export interface DealerResult {
  source: 'demo' | 'live';
  /** Never empty when the ZIP is valid (5 digits) — demo mode always fills. */
  dealers: Dealer[];
}

const ZIP_RE = /^\d{5}$/;

/** Fictional dealer names — picked rotationally from the ZIP hash. */
const DEALER_NAMES = [
  'Springfield Auto Mall',
  'Gateway Motors',
  'Summit Auto Group',
  'Crestview Auto Center',
  'Northside Automotive',
  'Pioneer Auto Haus',
  'Lakeside Motors',
  'Regency Auto Group',
  'Highline Motor Company',
  'Broadway Auto Outlet',
  'Ridgeline Cars',
  'Midtown Auto Exchange',
];

/** Fictional street names — combined with a hash-derived house number. */
const STREETS = [
  'Main St',
  'Central Ave',
  'Market St',
  'Oakwood Blvd',
  'Riverside Dr',
  'Fairview Ave',
  'Commerce Way',
  'Veterans Blvd',
  'Maple Ave',
  'Downtown Loop',
];

/** Deterministic hash of a string — stable across renders and platforms. */
function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Google Maps directions URL from an origin ZIP to a destination address. */
export function directionsUrl(originZip: string, destinationAddress: string): string {
  const params = new URLSearchParams({
    api: '1',
    origin: originZip,
    destination: destinationAddress,
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Nearby dealers for a 5-digit ZIP. Demo mode: five dealers picked
 * deterministically from the ZIP hash (names, streets, phone numbers, and
 * 2.5–20.5 mi distances all vary by ZIP but are stable per ZIP). Invalid or
 * missing ZIPs return an empty result — callers render an empty state, never
 * fabricated data for a ZIP we were not given.
 */
export function nearbyDealers(zip: string): DealerResult {
  const trimmed = (zip ?? '').trim();
  if (!ZIP_RE.test(trimmed)) return { source: 'demo', dealers: [] };

  const seed = hashString(trimmed);
  const names = [...DEALER_NAMES];
  // Rotate the pool by the hash so different ZIPs lead with different names.
  const rotated = names.splice(seed % names.length, names.length).concat(names);

  const dealers: Dealer[] = rotated.slice(0, 5).map((name, i) => {
    const street = STREETS[(seed + i * 3) % STREETS.length];
    const house = 100 + ((seed >> (i * 2)) % 8900);
    const address = `${house} ${street}`;
    const distanceMi = Math.round((2.5 + ((seed + i * 17) % 180) / 10) * 10) / 10;
    const phone = `(555) 01${(seed + i * 7) % 10}${String((seed + i * 11) % 100).padStart(2, '0')}-${String((seed + i * 13) % 10000).padStart(4, '0')}`;
    return {
      name,
      address,
      phone,
      distanceMi,
      directionsUrl: directionsUrl(trimmed, `${address}, ${trimmed}`),
    };
  });

  // Closest first — the UI copy promises it.
  dealers.sort((a, b) => a.distanceMi - b.distanceMi);

  return { source: 'demo', dealers };
}

function rec(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/**
 * The advisor's "winning vehicle": the compared vehicle with the LOWEST MSRP
 * (mirrors the comparison table's "Best" marker for the MSRP row). Ties pick
 * the first in the user's comparing order. Falls back to the first compared
 * vehicle when no MSRP specs are saved, and to null when nothing is compared.
 */
export function winningVehicleId(vehicles: AdvisorState['vehicles']): string | null {
  const v = rec(vehicles);
  const comparing = v?.comparing;
  if (!Array.isArray(comparing) || comparing.length === 0) return null;
  const specs = rec(v?.specs);
  const ids = comparing as string[];
  const priced = ids.map((id) => {
    const spec = rec(specs?.[id]);
    const msrp = spec && typeof spec.msrp === 'number' && Number.isFinite(spec.msrp) ? spec.msrp : null;
    return { id, msrp };
  });
  const withPrice = priced.filter((p) => p.msrp !== null) as { id: string; msrp: number }[];
  if (withPrice.length > 0) {
    const min = Math.min(...withPrice.map((p) => p.msrp));
    return withPrice.find((p) => p.msrp === min)?.id ?? ids[0];
  }
  return ids[0];
}

/** Human label for the winning vehicle (from the Step 2 names snapshot). */
export function winningVehicleLabel(vehicles: AdvisorState['vehicles']): string | null {
  const id = winningVehicleId(vehicles);
  if (!id) return null;
  const v = rec(vehicles);
  const names = rec(v?.names);
  const label = names?.[id];
  return typeof label === 'string' && label.trim() !== '' ? label : id;
}