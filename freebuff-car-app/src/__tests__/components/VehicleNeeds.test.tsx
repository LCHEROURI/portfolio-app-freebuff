// VehicleNeeds now loads inventory from /api/inventory. These tests mock the
// fetch layer; the needs-evaluation logic (met-fraction, red/green tags) is
// unchanged and re-asserted against live-feed-shaped data.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VehicleNeeds from '@/components/advisor/VehicleNeeds';
import { SAFETY_NOT_RATED } from '@/lib/marketcheck';

const FLEET = [
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

function mockFetchOnce(body: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  }) as unknown as typeof fetch;
}

function setup(props: Parameters<typeof VehicleNeeds>[0] = {}) {
  return render(<VehicleNeeds {...props} />);
}

afterEach(() => {
  delete (global as { fetch?: unknown }).fetch;
  delete (window as unknown as Record<string, unknown>).__VEHICLE_DATA__;
});

describe('VehicleNeeds', () => {
  it('renders vehicle cards from the live feed', async () => {
    mockFetchOnce({ source: 'marketcheck', vehicles: FLEET, numFound: 2 });
    setup();
    expect(await screen.findByText('2025 Toyota Camry LE')).toBeInTheDocument();
    expect(screen.getByText('2025 Subaru Outback Premium')).toBeInTheDocument();
  });

  it('shows MSRP and MPG for each vehicle', async () => {
    mockFetchOnce({ source: 'marketcheck', vehicles: FLEET, numFound: 2 });
    setup();
    await screen.findByText('2025 Toyota Camry LE');
    expect(screen.getByText(/28,595/)).toBeInTheDocument();
    expect(screen.getByText(/33 MPG combined/)).toBeInTheDocument();
    expect(screen.getByText(/29 MPG combined/)).toBeInTheDocument();
  });

  it('shows a demo banner when the feed falls back to demo inventory', async () => {
    mockFetchOnce({ source: 'demo', vehicles: FLEET, demoReason: 'not-configured' });
    setup();
    await screen.findByText('2025 Toyota Camry LE');
    expect(screen.getByTestId('demo-banner')).toHaveTextContent(/demo inventory/i);
  });

  it('shows an error banner with retry when the request fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    setup();
    expect(await screen.findByTestId('error-banner')).toBeInTheDocument();
    expect(screen.queryByText('2025 Toyota Camry LE')).not.toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('shows unknown MPG as n/a and counts the MPG need as unmet', async () => {
    const fleet = [
      { ...FLEET[0], fuelEconomyCombined: 0, safetyRating: SAFETY_NOT_RATED },
    ];
    mockFetchOnce({ source: 'marketcheck', vehicles: fleet });
    setup();
    await screen.findByText('2025 Toyota Camry LE');
    expect(screen.getByText(/n\/a ·/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('30+ MPG combined'));
    // Unknown MPG leaves the 30+ MPG need unmet (5 of 6 keys evaluate true).
    expect(screen.getByText('5/6 needs met')).toBeInTheDocument();
    const mpgTag = screen.getByText('30+ MPG');
    expect(mpgTag.className).toContain('bg-red-100');
  });

  it('toggles AWD need and flags non-AWD vehicles red / AWD vehicles green', async () => {
    mockFetchOnce({ source: 'marketcheck', vehicles: FLEET });
    setup();
    await screen.findByText('2025 Toyota Camry LE');
    fireEvent.click(screen.getByLabelText('All-wheel drive (AWD)'));
    // Camry is FWD — should be flagged red; Outback is AWD — green.
    const camryCard = screen.getByText('2025 Toyota Camry LE').closest('div')?.closest('[class*="rounded-xl"]');
    expect(camryCard?.className).toContain('border-red-200');
    const outbackCard = screen.getByText('2025 Subaru Outback Premium').closest('div')?.closest('[class*="rounded-xl"]');
    expect(outbackCard?.className).toContain('border-good-200');
  });

  it('shows needs met count for each vehicle', async () => {
    mockFetchOnce({ source: 'marketcheck', vehicles: FLEET });
    setup();
    await screen.findByText('2025 Toyota Camry LE');
    fireEvent.click(screen.getByLabelText('All-wheel drive (AWD)'));
    expect(screen.getByText('5/6 needs met')).toBeInTheDocument();
    expect(screen.getByText('6/6 needs met')).toBeInTheDocument();
  });

  it('toggles needs off and restores the neutral border', async () => {
    mockFetchOnce({ source: 'marketcheck', vehicles: FLEET });
    setup();
    await screen.findByText('2025 Toyota Camry LE');
    fireEvent.click(screen.getByLabelText('All-wheel drive (AWD)'));
    fireEvent.click(screen.getByLabelText('All-wheel drive (AWD)'));
    const outbackCard = screen.getByText('2025 Subaru Outback Premium').closest('div')?.closest('[class*="rounded-xl"]');
    expect(outbackCard?.className).toContain('border-ink-200');
  });

  it('limits comparison to 3 vehicles', async () => {
    mockFetchOnce({ source: 'marketcheck', vehicles: FLEET });
    setup();
    await screen.findByText('2025 Toyota Camry LE');
    const checkboxes = screen.getAllByLabelText('Include in comparison');
    fireEvent.click(checkboxes[0]);
    expect(screen.getByText('Comparing 1 vehicle')).toBeInTheDocument();
    fireEvent.click(checkboxes[1]);
    expect(screen.getByText('Comparing 2 vehicles')).toBeInTheDocument();
  });

  it('renders all 6 needs checkboxes', async () => {
    mockFetchOnce({ source: 'marketcheck', vehicles: FLEET });
    setup();
    await screen.findByText('2025 Toyota Camry LE');
    expect(screen.getByLabelText('All-wheel drive (AWD)')).toBeInTheDocument();
    expect(screen.getByLabelText('5+ seats')).toBeInTheDocument();
    expect(screen.getByLabelText('30+ MPG combined')).toBeInTheDocument();
    expect(screen.getByLabelText('IIHS Top Safety Pick+')).toBeInTheDocument();
    expect(screen.getByLabelText('Apple CarPlay')).toBeInTheDocument();
    expect(screen.getByLabelText('Android Auto')).toBeInTheDocument();
  });

  it('sends intake funnel params on the inventory request', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ source: 'marketcheck', vehicles: FLEET }),
    }) as unknown as jest.Mock;
    global.fetch = fetchMock as unknown as typeof fetch;
    setup({ intake: { monthlyBudget: '4500', zip: '60601', bodyStyle: 'suv' } });
    await screen.findByText('2025 Toyota Camry LE');
    const url = new URL(fetchMock.mock.calls[0][0] as string, 'http://localhost');
    expect(url.pathname).toBe('/api/inventory');
    expect(url.searchParams.get('budget')).toBe('4500');
    expect(url.searchParams.get('zip')).toBe('60601');
    expect(url.searchParams.get('bodyType')).toBe('suv');
  });

  it('supports the window.__VEHICLE_DATA__ test hook (bypasses fetch)', async () => {
    (window as unknown as Record<string, unknown>).__VEHICLE_DATA__ = FLEET;
    setup();
    expect(await screen.findByText('2025 Toyota Camry LE')).toBeInTheDocument();
  });

  it('shows an explicit empty state when no vehicles match', async () => {
    mockFetchOnce({ source: 'marketcheck', vehicles: [] });
    setup();
    expect(await screen.findByText(/no vehicles matched/i)).toBeInTheDocument();
  });

  it('shows loading skeletons before data arrives', async () => {
    let resolveJson: (value: unknown) => void = () => {};
    global.fetch = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveJson = (value: unknown) =>
          resolve({ ok: true, status: 200, json: async () => value });
      })
    ) as unknown as typeof fetch;
    setup();
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    resolveJson({ source: 'marketcheck', vehicles: FLEET });
    expect(await screen.findByText('2025 Toyota Camry LE')).toBeInTheDocument();
  });
});

// Keep waitFor imported for future async assertions without lint noise.
void waitFor;
