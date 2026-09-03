// Pure mapping layer between MarketCheck inventory listings and the app's
// Vehicle shape. No fetch logic here — the API route does I/O; this module
// stays unit-testable.
import type { Vehicle } from '@/data/vehicles';

/** MPG sentinel: the feed omits MPG on many listings. 0 means "unknown" —
 * VehicleNeeds renders it as "n/a" and counts the 30+ MPG need as unmet. */
export const MPG_UNKNOWN = 0;

export const SAFETY_NOT_RATED = 'Not rated in this feed';

/** Raw listing shape: only the fields we actually read. */
export interface MarketCheckListing {
  id?: string;
  vin?: string;
  price?: number;
  msrp?: number;
  miles?: number;
  build?: {
    year?: number;
    make?: string;
    model?: string;
    trim?: string;
    drivetrain?: string;
    mpg?: string;
    mpg_city?: number;
    mpg_highway?: number;
    seats?: number | string;
    high_value_features?: string[];
  };
  dealer?: { city?: string; state?: string };
}

export interface MappedInventory {
  vehicles: Vehicle[];
  numFound: number;
}

function toNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function normalizeDrive(raw: string | undefined): string {
  const d = (raw ?? '').toLowerCase();
  if (d.includes('4wd') || d.includes('4x4')) return 'awd'; // treat 4WD as AWD for need-matching
  if (d.includes('awd') || d.includes('all wheel')) return 'awd';
  return 'fwd';
}

function combinedMpg(build: MarketCheckListing['build']): number {
  if (!build) return MPG_UNKNOWN;
  // mpg is the combined figure when present; else average city/highway.
  const combined = toNumber(build.mpg);
  if (combined !== null && combined > 0) return Math.round(combined);
  const city = toNumber(build.mpg_city);
  const hwy = toNumber(build.mpg_highway);
  if (city !== null && hwy !== null && city + hwy > 0) return Math.round((city + hwy) / 2);
  return MPG_UNKNOWN;
}

function parseSeats(raw: unknown): number {
  const n = toNumber(raw);
  // Most sedans/CUVs seat 5; treat absent data as 5 rather than failing the card.
  return n !== null && n > 0 ? Math.round(n) : 5;
}

function techChips(build: MarketCheckListing['build']): string[] {
  const features = build?.high_value_features ?? [];
  const cleaned = features
    .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    .map((f) => f.trim());
  return Array.from(new Set(cleaned)).slice(0, 6);
}

/** Map one listing; null when the listing lacks enough data to show a card. */
export function mapListing(listing: MarketCheckListing): Vehicle | null {
  const build = listing.build ?? {};
  const make = build.make?.trim();
  const model = build.model?.trim();
  const year = toNumber(build.year);
  if (!make || !model || year === null) return null;

  const msrp = toNumber(listing.msrp) ?? toNumber(listing.price);
  if (msrp === null || msrp <= 0) return null;

  const trim = build.trim?.trim() || 'Base';
  const id =
    listing.id ??
    `${year}-${make}-${model}-${trim}-${msrp}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return {
    id,
    make,
    model,
    year,
    trim,
    msrp: Math.round(msrp),
    fuelEconomyCombined: combinedMpg(build),
    seating: parseSeats(build.seats),
    drive: normalizeDrive(build.drivetrain),
    // MarketCheck carries no IIHS data — the card shows this string as-is and
    // the Top Safety Pick+ need evaluates red. Honest, never fabricated.
    safetyRating: SAFETY_NOT_RATED,
    tech: techChips(build),
  };
}

/** Map a full search response; dedupes trim clones that share a price. */
export function mapInventoryResponse(payload: unknown): MappedInventory {
  const listings = (payload as { listings?: unknown } | null)?.listings;
  if (!Array.isArray(listings)) return { vehicles: [], numFound: 0 };

  const numFoundRaw = (payload as { num_found?: unknown }).num_found;
  const numFound = toNumber(numFoundRaw) ?? listings.length;

  const vehicles: Vehicle[] = [];
  const seen = new Set<string>();
  for (const listing of listings as MarketCheckListing[]) {
    const vehicle = mapListing(listing);
    if (!vehicle) continue;
    const key = `${vehicle.year}|${vehicle.make}|${vehicle.model}|${vehicle.trim}|${vehicle.msrp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    vehicles.push(vehicle);
    if (vehicles.length >= 12) break;
  }
  return { vehicles, numFound };
}
