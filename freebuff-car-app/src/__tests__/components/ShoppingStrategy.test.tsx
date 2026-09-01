import { render, screen, fireEvent } from '@testing-library/react';
import ShoppingStrategy from '@/components/advisor/ShoppingStrategy';

describe('ShoppingStrategy', () => {
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
      tech: ['Apple CarPlay', 'Android Auto'],
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
      tech: ['Apple CarPlay'],
    },
    {
      id: 'civil',
      make: 'Honda',
      model: 'Civic',
      year: 2025,
      trim: 'EX',
      msrp: 26295,
      fuelEconomyCombined: 35,
      seating: 5,
      drive: 'fwd',
      safetyRating: 'IIHS Top Safety Pick',
      tech: ['Android Auto'],
    },
  ];

  beforeEach(() => {
    (window as unknown as Record<string, unknown>).__VEHICLE_DATA__ = SAMPLE_VEHICLES;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__VEHICLE_DATA__;
  });

  it('renders the step header', () => {
    render(<ShoppingStrategy />);
    expect(screen.getByText('Step 6 of 8 — Auto Shopping Strategy & Recommendations')).toBeInTheDocument();
  });

  it('renders all 6 needs checkboxes', () => {
    render(<ShoppingStrategy />);
    expect(screen.getByLabelText(/all-wheel drive/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/5\+ seats/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/30\+ mpg combined/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/iihs top safety pick\+/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/apple carplay/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/android auto/i)).toBeInTheDocument();
  });

  it('shows a recommendation when no needs are selected', () => {
    render(<ShoppingStrategy />);
    expect(screen.getByText(/no non-negotiable needs selected yet/i)).toBeInTheDocument();
  });

  it('groups vehicles into tiers based on active needs', () => {
    render(<ShoppingStrategy />);
    // All 3 vehicles meet AWD? No — only Outback is AWD.
    fireEvent.click(screen.getByLabelText(/all-wheel drive/i));

    expect(screen.getByText('Tier 1')).toBeInTheDocument();
    expect(screen.getByText('Best matches — meets your non-negotiables')).toBeInTheDocument();

    // Outback is the only AWD vehicle → Tier 1
    expect(screen.getByText('2025 Subaru Outback Premium')).toBeInTheDocument();

    // Tier 2 should also render for vehicles that come close
    expect(screen.getByText('Tier 2')).toBeInTheDocument();
  });

  it('shows strengths and concerns for each vehicle', () => {
    render(<ShoppingStrategy />);
    fireEvent.click(screen.getByLabelText(/all-wheel drive/i));

    // Outback (Tier 1) should show strengths
    const outbackSection = screen.getByText('2025 Subaru Outback Premium').closest('.rounded-xl');
    expect(outbackSection).toBeInTheDocument();
    expect(screen.getByText('all-wheel drive')).toBeInTheDocument();
    expect(outbackSection!.getElementsByTagName('p')[0].textContent).toContain('29 MPG combined');
  });

  it('shows a plain-language next step recommendation', () => {
    render(<ShoppingStrategy />);
    fireEvent.click(screen.getByLabelText(/all-wheel drive/i));

    expect(screen.getByText(/focus on these first/i)).toBeInTheDocument();
    expect(screen.getByText(/2025 Subaru Outback Premium/)).toBeInTheDocument();
  });

  it('shows the continue button when vehicles are loaded', () => {
    render(<ShoppingStrategy />);
    // Continue button only renders when onContinue prop is provided AND vehicles exist.
    const onContinue = jest.fn();
    render(<ShoppingStrategy onContinue={onContinue} />);
    expect(screen.getByRole('button', { name: /continue to budget breakdown/i })).toBeInTheDocument();
  });

  it('calls onContinue when continue button is clicked', () => {
    const onContinue = jest.fn();
    render(<ShoppingStrategy onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: /continue to budget breakdown/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
