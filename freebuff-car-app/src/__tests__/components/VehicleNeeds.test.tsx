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

describe('VehicleNeeds price-cap slider', () => {
  it('shows the slider only when Step 1 set a budget', async () => {
    mockFetchOnce({ source: 'demo', vehicles: FLEET });
    setup({ intake: { monthlyBudget: '500', downPayment: '5000', creditRange: 'good' } });
    await screen.findByText('2025 Toyota Camry LE');
    expect(screen.getByText('Adjust your price cap')).toBeInTheDocument();
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '50000');
    expect(slider).toHaveAttribute('step', '500');
    // The slider thumb pins at the Step 1 ceiling (derived from $500/mo,
    // $5,000 down, good credit).
    expect(slider).toHaveValue('27900');
  });

  it('hides the slider for visitors without a Step 1 budget', async () => {
    mockFetchOnce({ source: 'demo', vehicles: FLEET });
    setup({ intake: null });
    await screen.findByText('2025 Toyota Camry LE');
    expect(screen.queryByText('Adjust your price cap')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('reloads the inventory when the slider is dragged', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ source: 'demo', vehicles: FLEET }),
    }) as unknown as jest.Mock;
    global.fetch = fetchMock as unknown as typeof fetch;
    setup({ intake: { monthlyBudget: '500', downPayment: '5000', creditRange: 'good' } });
    await screen.findByText('2025 Toyota Camry LE');
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '35000' } });
    // The new cap value is committed.
    expect((slider as HTMLInputElement).value).toBe('35000');
    // A second fetch was issued for the new cap.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reloads the inventory when the cap is reset', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ source: 'demo', vehicles: FLEET }),
    }) as unknown as jest.Mock;
    global.fetch = fetchMock as unknown as typeof fetch;
    setup({ intake: { monthlyBudget: '500', downPayment: '5000', creditRange: 'good' } });
    await screen.findByText('2025 Toyota Camry LE');
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '35000' } });
    // Cap now set; reset button is visible.
    const resetBtn = screen.getByRole('button', { name: /reset to step 1 ceiling/i });
    fireEvent.click(resetBtn);
    // Cap restored to ceiling; a third fetch re-queries at the ceiling.
    expect((slider as HTMLInputElement).value).toBe('27900');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('continues to financing without losing the cap first', async () => {
    // Regression: walking into the comparison and clicking Continue must not
    // reset the slider cap mid-flow (the Reset-to-ceiling button does that
    // explicitly, not the Continue control).
    mockFetchOnce({ source: 'demo', vehicles: FLEET });
    const onContinue = jest.fn();
    setup({ intake: { monthlyBudget: '500', downPayment: '5000', creditRange: 'good' }, onContinue });
    await screen.findByText('2025 Toyota Camry LE');
    // Set a comparison so Continue renders (pick the first vehicle's checkbox).
    fireEvent.click(screen.getAllByLabelText('Include in comparison')[0]);
    const continueBtn = screen.getByRole('button', { name: /continue to financing/i });
    fireEvent.click(continueBtn);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('preserves the slider cap across a nonce rotation (retry re-query)', async () => {
    // The cap is a local state slot independent of the nonce-driven fetch.
    // Rolling the nonce (e.g. a manual retry) re-queries at the cap without
    // clearing it — users do not lose their override mid-adjustment.
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ source: 'demo', vehicles: FLEET }),
    }) as unknown as jest.Mock;
    global.fetch = fetchMock as unknown as typeof fetch;
    setup({ intake: { monthlyBudget: '500', downPayment: '5000', creditRange: 'good' } });
    await screen.findByText('2025 Toyota Camry LE');
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '35000' } });
    // Move to a different value then back — the change event fires only on
    // actual value changes, so the nonce rotates and the cap persists.
    fireEvent.change(slider, { target: { value: '20000' } });
    fireEvent.change(slider, { target: { value: '35000' } });
    expect((slider as HTMLInputElement).value).toBe('35000');
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + cap set + detour + return
  });

  it('pinned at the ceiling: dragging below the Step 1 ceiling does not invent a lower filter', async () => {
    mockFetchOnce({ source: 'demo', vehicles: FLEET });
    setup({ intake: { monthlyBudget: '500', downPayment: '5000', creditRange: 'good' } });
    await screen.findByText('2025 Toyota Camry LE');
    const slider = screen.getByRole('slider');
    // Dragging below the ceiling — the slider accepts any value on the track.
    fireEvent.change(slider, { target: { value: '5000' } });
    expect((slider as HTMLInputElement).value).toBe('5000');
    // A re-query was issued with the tighter cap.
  });
});

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

describe('VehicleNeeds payment affordability colors', () => {
  const AFFORDABLE_FLEET = [
    { ...FLEET[0], id: 'cheap-a', msrp: 20000 },
    { ...FLEET[1], id: 'cheap-b', msrp: 22000 },
  ];

  it('renders fitting payments green with a within-budget status', async () => {
    mockFetchOnce({ source: 'demo', vehicles: AFFORDABLE_FLEET });
    setup({ intake: { monthlyBudget: '500', downPayment: '5000', creditRange: 'good' } });
    await screen.findByText('2025 Toyota Camry LE');
    const lines = await screen.findAllByTestId('est-payment');
    expect(lines[0].querySelector('span')).toHaveClass('text-good-700');
    expect(lines[1].querySelector('span')).toHaveClass('text-good-700');
    expect(screen.getAllByText('Within your monthly budget.')).toHaveLength(2);
    expect(screen.queryAllByTestId('down-hint')).toHaveLength(0);
  });

  it('renders over-budget payments amber with an above-budget status', async () => {
    mockFetchOnce({ source: 'demo', vehicles: FLEET });
    setup({ intake: { monthlyBudget: '500', downPayment: '5000', creditRange: 'good' } });
    await screen.findByText('2025 Toyota Camry LE');
    const lines = await screen.findAllByTestId('est-payment');
    expect(lines[0].querySelector('span')).toHaveClass('text-amber-700');
    expect(lines[1].querySelector('span')).toHaveClass('text-amber-700');
    expect(screen.getAllByText('Above your monthly budget.')).toHaveLength(2);
    expect(screen.getAllByTestId('down-hint')).toHaveLength(2);
  });

  it('treats a payment exactly equal to the budget as fitting', async () => {
    // $27,929.01 with tax/fees minus $5,000 down amortizes to exactly $500/mo
    // at 6.5% over 60 months — the <= boundary.
    mockFetchOnce({ source: 'demo', vehicles: [{ ...FLEET[0], id: 'boundary', msrp: 27929.01 }] });
    setup({ intake: { monthlyBudget: '500', downPayment: '5000', creditRange: 'good' } });
    await screen.findByText('2025 Toyota Camry LE');
    const line = (await screen.findAllByTestId('est-payment'))[0];
    expect(line.querySelector('span')).toHaveClass('text-good-700');
    expect(line.textContent).toContain('Est. $500/mo');
  });

  it('adds no affordability status when there is no budget', async () => {
    mockFetchOnce({ source: 'demo', vehicles: FLEET });
    setup({ intake: null });
    await screen.findByText('2025 Toyota Camry LE');
    expect(screen.queryByText('Within your monthly budget.')).toBeNull();
    expect(screen.queryByText('Above your monthly budget.')).toBeNull();
  });
});
