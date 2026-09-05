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
  it('sends budget, down payment, and credit tier from intake to the inventory API', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ source: 'demo', vehicles: FLEET }),
    }) as unknown as jest.Mock;
    global.fetch = fetchMock as unknown as typeof fetch;
    setup({
      intake: { monthlyBudget: '500', downPayment: '5000', creditRange: 'good', zip: '60601', bodyStyle: 'suv' },
    });
    await screen.findByText('2025 Toyota Camry LE');
    const url = new URL(fetchMock.mock.calls[0][0] as string, 'http://localhost');
    expect(url.searchParams.get('budget')).toBe('500');
    expect(url.searchParams.get('down')).toBe('5000');
    expect(url.searchParams.get('credit')).toBe('good');
    expect(url.searchParams.get('zip')).toBe('60601');
    expect(url.searchParams.get('bodyType')).toBe('suv');
  });

  it('shows an honest empty state when the budget matches nothing (live feed)', async () => {
    mockFetchOnce({ source: 'marketcheck', vehicles: [], numFound: 0, priceMax: 9800 });
    setup({ intake: { monthlyBudget: '150' } });
    expect(await screen.findByTestId('empty-results')).toBeInTheDocument();
    expect(screen.getByText('No vehicles under your budget yet')).toBeInTheDocument();
    // The explained ceiling uses the echoed priceMax.
    expect(screen.getByText(/9,800/)).toBeInTheDocument();
    expect(screen.queryAllByTestId('vehicle-card')).toHaveLength(0);
    // An honest empty result is NOT a demo fallback — no banner.
    expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument();
  });

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

  it('persists a specs snapshot for compared vehicles via onSaveData', async () => {
    mockFetchOnce({ source: 'marketcheck', vehicles: FLEET });
    const onSaveData = jest.fn();
    setup({ onSaveData });
    await screen.findByText('2025 Toyota Camry LE');
    fireEvent.click(screen.getAllByLabelText('Include in comparison')[0]);

    const last = onSaveData.mock.calls[onSaveData.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(last.comparing).toEqual(['camry']);
    const specs = last.specs as Record<string, Record<string, unknown>>;
    expect(specs.camry).toEqual({
      title: '2025 Toyota Camry LE',
      msrp: 28595,
      mpg: 33,
      seating: 5,
      drive: 'fwd',
      safety: 'IIHS Top Safety Pick+',
    });
    // Names map persists alongside (filename labeling for exports).
    expect((last.names as Record<string, string>).camry).toBe('Toyota Camry');
  });

  it('persists mpg as null for unknown-MPG vehicles and drops specs on un-compare', async () => {
    const fleet = [{ ...FLEET[0], fuelEconomyCombined: 0 }];
    mockFetchOnce({ source: 'marketcheck', vehicles: fleet });
    const onSaveData = jest.fn();
    setup({ onSaveData });
    await screen.findByText('2025 Toyota Camry LE');
    const box = screen.getAllByLabelText('Include in comparison')[0];
    fireEvent.click(box);

    let last = onSaveData.mock.calls[onSaveData.mock.calls.length - 1][0] as Record<string, unknown>;
    let specs = last.specs as Record<string, Record<string, unknown>>;
    expect(specs.camry.mpg).toBeNull(); // unknown MPG is null, never fabricated

    fireEvent.click(box); // un-compare
    last = onSaveData.mock.calls[onSaveData.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(last.comparing).toEqual([]);
    specs = last.specs as Record<string, Record<string, unknown>>;
    expect(specs.camry).toBeUndefined();
  });

  it('shows an explicit empty state when no vehicles match', async () => {
    mockFetchOnce({ source: 'marketcheck', vehicles: [] });
    setup();
    expect(await screen.findByTestId('empty-results')).toBeInTheDocument();
    expect(screen.getByText(/returned no matching vehicles/i)).toBeInTheDocument();
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

describe('VehicleNeeds estimated monthly payments', () => {
  it('shows the derived payment with its assumptions on each card', async () => {
    mockFetchOnce({ source: 'demo', vehicles: FLEET });
    setup({ intake: { monthlyBudget: '500', downPayment: '5000', creditRange: 'good' } });
    await screen.findByText('2025 Toyota Camry LE');
    const lines = await screen.findAllByTestId('est-payment');
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toContain('Est. $514/mo');
    expect(lines[0].textContent).toContain('60 mo at 6.5% APR with $5,000 down');
    expect(lines[1].textContent).toContain('Est. $598/mo');
    // Assumptions footer explains the derivation.
    expect(screen.getByText(/Payment estimates use your Step 1 down payment/)).toBeInTheDocument();
  });

  it('moves the payment with the credit tier', async () => {
    mockFetchOnce({ source: 'demo', vehicles: FLEET });
    setup({ intake: { monthlyBudget: '500', downPayment: '5000', creditRange: 'excellent' } });
    await screen.findByText('2025 Toyota Camry LE');
    const lines = await screen.findAllByTestId('est-payment');
    expect(lines[0].textContent).toContain('Est. $496/mo');
    expect(lines[0].textContent).toContain('at 5% APR');
  });

  it('is honest when the down payment leaves nothing to finance', async () => {
    mockFetchOnce({ source: 'demo', vehicles: FLEET });
    setup({ intake: { monthlyBudget: '500', downPayment: '50000', creditRange: 'good' } });
    await screen.findByText('2025 Toyota Camry LE');
    const lines = await screen.findAllByTestId('est-payment');
    expect(lines[0].textContent).toContain('Est. payment unavailable');
    expect(lines[0].textContent).toContain('leaves nothing to finance');
  });

  it('hides payment estimates when no Step 1 budget exists', async () => {
    mockFetchOnce({ source: 'demo', vehicles: FLEET });
    setup({ intake: null });
    await screen.findByText('2025 Toyota Camry LE');
    expect(screen.queryAllByTestId('est-payment')).toHaveLength(0);
  });
});

describe('VehicleNeeds over-budget down payment hints', () => {
  it('hints the exact extra down payment on every over-budget card', async () => {
    mockFetchOnce({ source: 'demo', vehicles: FLEET });
    setup({ intake: { monthlyBudget: '500', downPayment: '5000', creditRange: 'good' } });
    await screen.findByText('2025 Toyota Camry LE');
    const hints = await screen.findAllByTestId('down-hint');
    expect(hints).toHaveLength(2); // FLEET fixture: Camry + Outback, both over $500/mo
    expect(hints[0].textContent).toContain('About $5,800 down');
    expect(hints[0].textContent).toContain('within your $500/mo budget');
    expect(hints[1].textContent).toContain('About $10,000 down');
  });

  it('shows no hint when every payment already fits the budget', async () => {
    mockFetchOnce({ source: 'demo', vehicles: FLEET });
    setup({ intake: { monthlyBudget: '1000', downPayment: '5000', creditRange: 'good' } });
    await screen.findByText('2025 Toyota Camry LE');
    await screen.findAllByTestId('est-payment');
    expect(screen.queryAllByTestId('down-hint')).toHaveLength(0);
  });

  it('never hints when there is no Step 1 budget', async () => {
    mockFetchOnce({ source: 'demo', vehicles: FLEET });
    setup({ intake: null });
    await screen.findByText('2025 Toyota Camry LE');
    expect(screen.queryAllByTestId('down-hint')).toHaveLength(0);
  });
});
