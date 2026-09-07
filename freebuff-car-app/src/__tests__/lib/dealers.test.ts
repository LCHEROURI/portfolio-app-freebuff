import { nearbyDealers, directionsUrl, winningVehicleId, winningVehicleLabel } from '@/lib/dealers';
import type { AdvisorState } from '@/hooks/useAdvisorState';

describe('nearbyDealers', () => {
  it('returns five deterministic dealers for a valid 5-digit ZIP', () => {
    const a = nearbyDealers('94103');
    const b = nearbyDealers('94103');
    expect(a.dealers).toHaveLength(5);
    expect(a.source).toBe('demo');
    // Deterministic: the same ZIP always yields the same dealers.
    expect(a.dealers.map((d) => d.name)).toEqual(b.dealers.map((d) => d.name));
  });

  it('varies dealers by ZIP', () => {
    const a = nearbyDealers('94103').dealers.map((d) => d.name);
    const b = nearbyDealers('90210').dealers.map((d) => d.name);
    expect(a).not.toEqual(b);
  });

  it('gives every dealer a distance, phone, address, and directions link', () => {
    for (const dealer of nearbyDealers('02134').dealers) {
      expect(dealer.distanceMi).toBeGreaterThan(0);
      expect(dealer.phone).toMatch(/^\(555\) /);
      expect(dealer.address.length).toBeGreaterThan(3);
      expect(dealer.directionsUrl).toContain('google.com/maps/dir/');
    }
  });

  it('orders dealers closest-first', () => {
    const { dealers } = nearbyDealers('60601');
    const distances = dealers.map((d) => d.distanceMi);
    expect([...distances].sort((x, y) => x - y)).toEqual(distances);
  });

  it('returns an empty result for invalid or missing ZIPs', () => {
    expect(nearbyDealers('').dealers).toHaveLength(0);
    expect(nearbyDealers('1234').dealers).toHaveLength(0);
    expect(nearbyDealers('abcde').dealers).toHaveLength(0);
    expect(nearbyDealers('123456').dealers).toHaveLength(0);
    expect(nearbyDealers(undefined as unknown as string).dealers).toHaveLength(0);
  });
});

describe('directionsUrl', () => {
  it('builds a Google Maps URL from origin ZIP and destination address', () => {
    const url = directionsUrl('94103', '123 Main St, 94103');
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&origin=94103&destination=123+Main+St%2C+94103');
  });
});

const VEHICLES: AdvisorState['vehicles'] = {
  needs: {},
  comparing: ['camry', 'outback', 'rav4'],
  names: { camry: 'Toyota Camry', outback: 'Subaru Outback', rav4: 'Toyota RAV4' },
  specs: {
    camry: { title: '2025 Camry', msrp: 28595 },
    outback: { title: '2025 Outback', msrp: 32495 },
    rav4: { title: '2025 RAV4', msrp: 29995 },
  },
};

describe('winningVehicleId / winningVehicleLabel', () => {
  it('picks the lowest-MSRP compared vehicle', () => {
    expect(winningVehicleId(VEHICLES)).toBe('camry');
    expect(winningVehicleLabel(VEHICLES)).toBe('Toyota Camry');
  });

  it('breaks ties toward the first in comparing order', () => {
    const tied: AdvisorState['vehicles'] = {
      needs: {},
      comparing: ['outback', 'camry'],
      names: { outback: 'Subaru Outback', camry: 'Toyota Camry' },
      specs: {
        outback: { msrp: 28595 },
        camry: { msrp: 28595 },
      },
    };
    expect(winningVehicleId(tied)).toBe('outback');
  });

  it('falls back to the first compared vehicle when no MSRP is saved', () => {
    const noSpecs: AdvisorState['vehicles'] = {
      needs: {},
      comparing: ['outback', 'camry'],
      names: { outback: 'Subaru Outback', camry: 'Toyota Camry' },
    };
    expect(winningVehicleId(noSpecs)).toBe('outback');
    expect(winningVehicleLabel(noSpecs)).toBe('Subaru Outback');
  });

  it('returns null when nothing is compared', () => {
    expect(winningVehicleId({ needs: {}, comparing: [] })).toBeNull();
    expect(winningVehicleLabel(undefined)).toBeNull();
  });
});