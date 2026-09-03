// GET /api/inventory — live dealership inventory for advisor Step 2.
//
// Proxies MarketCheck's /v2/search/car/active with the API key held
// server-side only. Contract with the client:
//   200 { source: 'marketcheck', vehicles: Vehicle[], numFound: number }
//   200 { source: 'demo', vehicles: SAMPLE_VEHICLES, numFound: 3 }
// The demo fallback covers "no key configured" and "upstream error" alike,
// so Step 2 always renders working cards. The `demoReason` field on the
// demo payload distinguishes the two for debugging.
import { NextRequest, NextResponse } from 'next/server';
import { mapInventoryResponse, type MarketCheckListing } from '@/lib/marketcheck';
import { SAMPLE_VEHICLES } from '@/data/vehicles';

const MC_ENDPOINT = 'https://marketcheck.com/v2/search/car/active';
const PAGE_ROWS = 12;

interface DemoBody {
  source: 'demo';
  vehicles: typeof SAMPLE_VEHICLES;
  numFound: number;
  demoReason: 'not-configured' | 'upstream-error';
}

function demoResponse(reason: DemoBody['demoReason']): NextResponse {
  const body: DemoBody = {
    source: 'demo',
    vehicles: SAMPLE_VEHICLES,
    numFound: SAMPLE_VEHICLES.length,
    demoReason: reason,
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.MARKETCHECK_API_KEY;
  if (!apiKey) return demoResponse('not-configured');

  const params = request.nextUrl.searchParams;
  const zip = (params.get('zip') ?? '').trim();
  const bodyType = (params.get('bodyType') ?? '').trim();

  const mc = new URLSearchParams({
    api_key: apiKey,
    car_type: 'new',
    rows: String(PAGE_ROWS),
    sort_by: 'msrp',
  });
  // Only forward parameters MarketCheck actually accepts; ignore empties.
  if (/^\d{5}$/.test(zip)) mc.set('zip', zip);
  if (bodyType) mc.set('body_type', bodyType.toLowerCase());

  try {
    const upstream = await fetch(`${MC_ENDPOINT}?${mc.toString()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!upstream.ok) return demoResponse('upstream-error');

    const payload: unknown = await upstream.json();
    const mapped = mapInventoryResponse(payload);
    // An empty/unparseable payload is treated as an upstream failure so the
    // client never renders an empty results page when the feed misbehaves.
    if (mapped.vehicles.length === 0) return demoResponse('upstream-error');

    return NextResponse.json(
      { source: 'marketcheck', vehicles: mapped.vehicles, numFound: mapped.numFound },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return demoResponse('upstream-error');
  }
}

// Re-exported for tests: the raw listing type is otherwise unreachable from
// the test surface (mapInventoryResponse takes `unknown`).
export type { MarketCheckListing };
