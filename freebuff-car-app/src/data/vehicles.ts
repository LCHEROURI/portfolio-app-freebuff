export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  trim: string;
  msrp: number;
  fuelEconomyCombined: number;
  seating: number;
  drive: string;
  safetyRating: string;
  tech: string[];
}

/**
 * Sample fleet used by the advisor flow. In the running app these are loaded
 * directly; tests may override via `window.__VEHICLE_DATA__`.
 */
export const SAMPLE_VEHICLES: Vehicle[] = [
  {
    id: 'camry',
    make: 'Toyota',
    model: 'Camry',
    year: 2025,
    trim: 'LE',
    msrp: 28595,
    fuelEconomyCombined: 33,
    seating: 5,
    drive: 'fwd',
    safetyRating: 'IIHS Top Safety Pick+',
    tech: ['Apple CarPlay', 'Android Auto', 'Toyota Safety Sense 3.0'],
  },
  {
    id: 'outback',
    make: 'Subaru',
    model: 'Outback',
    year: 2025,
    trim: 'Premium',
    msrp: 32495,
    fuelEconomyCombined: 29,
    seating: 5,
    drive: 'awd',
    safetyRating: 'IIHS Top Safety Pick+',
    tech: ['Apple CarPlay', 'Android Auto', 'Subaru EyeSight'],
  },
  {
    id: 'rav4',
    make: 'Toyota',
    model: 'RAV4',
    year: 2025,
    trim: 'XLE',
    msrp: 30475,
    fuelEconomyCombined: 28,
    seating: 5,
    drive: 'awd',
    safetyRating: 'IIHS Top Safety Pick+',
    tech: ['Apple CarPlay', 'Android Auto', 'Toyota Safety Sense 3.0'],
  },
];
