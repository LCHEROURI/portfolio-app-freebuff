/**
 * @jest-environment node
 *
 * Route handler tests: call GET directly with a crafted NextRequest and a
 * mocked global fetch (the route proxies MarketCheck upstream). Runs under
 * Node's jest environment because `next/server` extends the Web Request
 * global at import time, which jsdom's window scope does not provide.
 */
import { GET } from '@/app/api/inventory/route';
import { NextRequest } from 'next/server';
import { SAMPLE_VEHICLES } from '@/data/vehicles';
import { SAFETY_NOT_RATED } from '@/lib/marketcheck';

function request(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/inventory${query}`);
}

function upstreamOk(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}

const MC_LISTING = {
  id: 'mc-9',
  msrp: 31500,
  build: {
    year: 2025,
    make: 'Honda',
    model: 'Accord',
    trim: 'EX',
    drivetrain: '4WD',
    mpg_city: 32,
    mpg_highway: 38,
    seats: 5,
    high_value_features: ['Apple CarPlay'],
  },
};

describe('GET /api/inventory', () => {
  const savedFetch = global.fetch;

  afterEach(() => {
    global.fetch = savedFetch;
    delete process.env.MARKETCHECK_API_KEY;
  });

  it('returns demo inventory when no API key is configured', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('demo');
    expect(body.demoReason).toBe('not-configured');
    expect(body.vehicles).toEqual(SAMPLE_VEHICLES);
  });

  it('returns demo inventory when upstream fails', async () => {
    process.env.MARKETCHECK_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    const res = await GET(request());
    const body = await res.json();
    expect(body.source).toBe('demo');
    expect(body.demoReason).toBe('upstream-error');
  });

  it('returns demo inventory when upstream returns no mappable listings', async () => {
    process.env.MARKETCHECK_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue(upstreamOk({ listings: [] })) as unknown as typeof fetch;
    const res = await GET(request());
    const body = await res.json();
    expect(body.source).toBe('demo');
    expect(body.demoReason).toBe('upstream-error');
  });

  it('maps live listings and forwards filters as query params', async () => {
    process.env.MARKETCHECK_API_KEY = 'test-key';
    const fetchMock = jest.fn().mockResolvedValue(
      upstreamOk({ num_found: 87, listings: [MC_LISTING] })
    ) as unknown as jest.Mock;
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await GET(request('?zip=60601&bodyType=suv&budget=4500'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('marketcheck');
    expect(body.numFound).toBe(87);
    expect(body.vehicles[0]).toMatchObject({
      id: 'mc-9',
      make: 'Honda',
      model: 'Accord',
      drive: 'awd', // 4WD normalized to awd
      fuelEconomyCombined: 35, // (32 + 38) / 2
      safetyRating: SAFETY_NOT_RATED,
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe('/v2/search/car/active');
    expect(calledUrl.searchParams.get('api_key')).toBe('test-key');
    expect(calledUrl.searchParams.get('zip')).toBe('60601');
    expect(calledUrl.searchParams.get('body_type')).toBe('suv');
    expect(calledUrl.searchParams.get('car_type')).toBe('new');
    expect(calledUrl.searchParams.get('rows')).toBe('12');
    // A non-5-digit zip must NOT be forwarded.
    const res2 = await GET(request('?zip=abc'));
    await res2.json();
    const url2 = new URL(fetchMock.mock.calls[1][0] as string);
    expect(url2.searchParams.get('zip')).toBeNull();
  });

  it('never exposes the API key in the response body', async () => {
    process.env.MARKETCHECK_API_KEY = 'super-secret-key';
    global.fetch = jest.fn().mockResolvedValue(
      upstreamOk({ num_found: 1, listings: [MC_LISTING] })
    ) as unknown as typeof fetch;
    const res = await GET(request());
    const text = await res.text();
    expect(text).not.toContain('super-secret-key');
  });
});
