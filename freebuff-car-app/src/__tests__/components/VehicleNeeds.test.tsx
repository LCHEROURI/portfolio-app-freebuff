import { render, screen, fireEvent } from '@testing-library/react';
import VehicleNeeds from '@/components/advisor/VehicleNeeds';

const SAMPLE_VEHICLES = [
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
];

function setupWithVehicles(vehicles: typeof SAMPLE_VEHICLES) {
  const vehicleData = vehicles as unknown as Record<string, unknown>;
  (window as unknown as Record<string, unknown>).__VEHICLE_DATA__ = vehicleData;
  return render(<VehicleNeeds />);
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__VEHICLE_DATA__;
});

describe('VehicleNeeds', () => {
  it('renders vehicle cards when vehicles are loaded', () => {
    setupWithVehicles(SAMPLE_VEHICLES);
    expect(screen.getByText('2025 Toyota Camry LE')).toBeInTheDocument();
    expect(screen.getByText('2025 Subaru Outback Premium')).toBeInTheDocument();
  });

  it('shows MSRP and MPG for each vehicle', () => {
    setupWithVehicles(SAMPLE_VEHICLES);
    expect(screen.getByText(/28,595/)).toBeInTheDocument();
    expect(screen.getByText(/33 MPG combined/)).toBeInTheDocument();
    expect(screen.getByText(/32,495/)).toBeInTheDocument();
    expect(screen.getByText(/29 MPG combined/)).toBeInTheDocument();
  });

  it('toggles AWD need and flags non-AWD vehicles', () => {
    setupWithVehicles(SAMPLE_VEHICLES);
    fireEvent.click(screen.getByLabelText('All-wheel drive (AWD)'));
    // Camry is FWD — should be flagged red
    const camryCard = screen.getByText('2025 Toyota Camry LE').closest('div')?.closest('[class*="rounded-xl"]');
    expect(camryCard?.className).toContain('border-red-200');
    // Outback is AWD — should be green
    const outbackCard = screen.getByText('2025 Subaru Outback Premium').closest('div')?.closest('[class*="rounded-xl"]');
    expect(outbackCard?.className).toContain('border-good-200');
  });

  it('shows needs met count for each vehicle', () => {
    setupWithVehicles(SAMPLE_VEHICLES);
    fireEvent.click(screen.getByLabelText('All-wheel drive (AWD)'));
    expect(screen.getByText('5/6 needs met')).toBeInTheDocument();
    expect(screen.getByText('6/6 needs met')).toBeInTheDocument();
  });

  it('toggles needs off and restores green border', () => {
    setupWithVehicles(SAMPLE_VEHICLES);
    fireEvent.click(screen.getByLabelText('All-wheel drive (AWD)'));
    const outbackCard = screen.getByText('2025 Subaru Outback Premium').closest('div')?.closest('[class*="rounded-xl"]');
    expect(outbackCard?.className).toContain('border-good-200');
    fireEvent.click(screen.getByLabelText('All-wheel drive (AWD)'));
    const outbackCard2 = screen.getByText('2025 Subaru Outback Premium').closest('div')?.closest('[class*="rounded-xl"]');
    expect(outbackCard2?.className).toContain('border-ink-200');
  });

  it('limits comparison to 3 vehicles', () => {
    setupWithVehicles(SAMPLE_VEHICLES);
    const checkboxes = screen.getAllByLabelText('Include in comparison');
    fireEvent.click(checkboxes[0]);
    expect(screen.getByText('Comparing 1 vehicle')).toBeInTheDocument();
    fireEvent.click(checkboxes[1]);
    expect(screen.getByText('Comparing 2 vehicles')).toBeInTheDocument();
  });

  it('falls back to the sample fleet when no window data is set', () => {
    render(<VehicleNeeds />);
    expect(screen.getByText('2025 Toyota Camry LE')).toBeInTheDocument();
    expect(screen.getByText('2025 Subaru Outback Premium')).toBeInTheDocument();
  });

  it('renders all 6 needs checkboxes', () => {
    setupWithVehicles(SAMPLE_VEHICLES);
    expect(screen.getByLabelText('All-wheel drive (AWD)')).toBeInTheDocument();
    expect(screen.getByLabelText('5+ seats')).toBeInTheDocument();
    expect(screen.getByLabelText('30+ MPG combined')).toBeInTheDocument();
    expect(screen.getByLabelText('IIHS Top Safety Pick+')).toBeInTheDocument();
    expect(screen.getByLabelText('Apple CarPlay')).toBeInTheDocument();
    expect(screen.getByLabelText('Android Auto')).toBeInTheDocument();
  });
});
