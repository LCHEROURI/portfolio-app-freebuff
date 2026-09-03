import {
  mapListing,
  mapInventoryResponse,
  MPG_UNKNOWN,
  SAFETY_NOT_RATED,
  type MarketCheckListing,
} from '@/lib/marketcheck';

function listing(overrides: Partial<MarketCheckListing> = {}): MarketCheckListing {
  return {
    id: 'mc-1',
    msrp: 30000,
    build: {
      year: 2025,
      make: 'Toyota',
      model: 'Camry',
      trim: 'LE',
      drivetrain: 'FWD',
      mpg: '33',
      seats: 5,
      high_value_features: ['Apple CarPlay', 'Android Auto'],
    },
    ...overrides,
  };
}

describe('mapListing', () => {
  it('maps a full listing to the Vehicle shape', () => {
    const v = mapListing(listing());
    expect(v).toEqual({
      id: 'mc-1',
      make: 'Toyota',
      model: 'Camry',
      year: 2025,
      trim: 'LE',
      msrp: 30000,
      fuelEconomyCombined: 33,
      seating: 5,
      drive: 'fwd',
      safetyRating: SAFETY_NOT_RATED,
      tech: ['Apple CarPlay', 'Android Auto'],
    });
  });

  it('normalizes 4WD and AWD drivetrains to awd', () => {
    expect(mapListing(listing({ build: { year: 2025, make: 'S', model: 'M', drivetrain: '4WD' } }))?.drive).toBe('awd');
    expect(mapListing(listing({ build: { year: 2025, make: 'S', model: 'M', drivetrain: 'All Wheel Drive' } }))?.drive).toBe('awd');
    expect(mapListing(listing({ build: { year: 2025, make: 'S', model: 'M', drivetrain: 'FWD' } }))?.drive).toBe('fwd');
  });

  it('averages city and highway MPG when the combined figure is missing', () => {
    const v = mapListing(listing({ build: { year: 2025, make: 'S', model: 'M', mpg_city: 30, mpg_highway: 40 } }));
    expect(v?.fuelEconomyCombined).toBe(35);
  });

  it('uses the MPG_UNKNOWN sentinel when no MPG data exists', () => {
    const v = mapListing(listing({ build: { year: 2025, make: 'S', model: 'M' } }));
    expect(v?.fuelEconomyCombined).toBe(MPG_UNKNOWN);
  });

  it('defaults absent seats to 5 and parses string seats', () => {
    expect(mapListing(listing({ build: { year: 2025, make: 'S', model: 'M' } }))?.seating).toBe(5);
    expect(mapListing(listing({ build: { year: 2025, make: 'S', model: 'M', seats: '7' } }))?.seating).toBe(7);
  });

  it('falls back from msrp to price', () => {
    const v = mapListing(listing({ msrp: undefined, price: 27500 }));
    expect(v?.msrp).toBe(27500);
  });

  it('defaults a missing trim to Base and synthesizes an id', () => {
    const v = mapListing(listing({ id: undefined, build: { year: 2025, make: 'Acme', model: 'Zed' } }));
    expect(v?.trim).toBe('Base');
    expect(v?.id).toBe('2025-acme-zed-base-30000');
  });

  it('returns null when make, model, year, or a usable price is missing', () => {
    expect(mapListing(listing({ build: { model: 'Camry', year: 2025 } }))).toBeNull();
    expect(mapListing(listing({ build: { make: 'Toyota', year: 2025 } }))).toBeNull();
    expect(mapListing(listing({ build: { make: 'Toyota', model: 'Camry' } }))).toBeNull();
    expect(mapListing(listing({ msrp: undefined }))).toBeNull();
    expect(mapListing(listing({ msrp: 0 }))).toBeNull();
  });

  it('dedupes and caps tech chips at 6', () => {
    const v = mapListing(listing({
      build: {
        year: 2025,
        make: 'S',
        model: 'M',
        high_value_features: ['A', 'A', 'B', 'C', 'D', 'E', 'F', 'G', ' '],
      },
    }));
    expect(v?.tech).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });
});

describe('mapInventoryResponse', () => {
  it('maps listings, dedupes clones, and reports numFound', () => {
    const payload = {
      num_found: 250,
      listings: [listing(), listing(), listing({ id: 'mc-2', msrp: 32000 })],
    };
    const { vehicles, numFound } = mapInventoryResponse(payload);
    expect(numFound).toBe(250);
    expect(vehicles).toHaveLength(2);
    expect(vehicles.map((v) => v.id)).toEqual(['mc-1', 'mc-2']);
  });

  it('returns empty for malformed payloads', () => {
    expect(mapInventoryResponse(null).vehicles).toEqual([]);
    expect(mapInventoryResponse({}).vehicles).toEqual([]);
    expect(mapInventoryResponse({ listings: 'nope' }).vehicles).toEqual([]);
  });

  it('caps output at 12 vehicles', () => {
    const listings = Array.from({ length: 20 }, (_, i) =>
      listing({ id: `id-${i}`, msrp: 20000 + i })
    );
    expect(mapInventoryResponse({ listings }).vehicles).toHaveLength(12);
  });
});
