import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// End-to-end: Intelligence Report generate + download, against the PRODUCTION
// build (playwright.config webServer runs `next build && next start`).
//
// The session is seeded into localStorage before app scripts run (via
// addInitScript), mirroring exactly what the advisor saves across Steps 1-10:
// budget, financing math, trade, dealer fees, ownership, needs, the compared
// vehicles with their names, and a computed deal score. The UI then drives
// the real consent gate, the real Generate button, and the real Download
// buttons — asserting the vehicle-named filenames and the full file contents
// on disk.

const SESSION = {
  step: 11,
  maxStep: 11,
  consent: true,
  intake: { monthlyBudget: '4500', downPayment: '5000', creditRange: 'good', zip: '60601', bodyStyle: 'suv' },
  finance: { vehiclePrice: '32000', downPayment: '5000', apr: '6', termMonths: '60' },
  lease: {
    newPrice: '30000', newDown: '5000', newApr: '6', newTerm: '60',
    leaseMonthly: '450', leaseDueAtSigning: '2500', leaseTerm: '36', leaseMileage: '12000',
    usedPrice: '20000', usedDown: '3000', usedApr: '7', usedTerm: '48', usedMiles: '45000',
  },
  trade: { tradeValue: '12000', payoff: '9000' },
  fees: { docFee: '299', titleRegistration: '345', addOnsText: 'Fabric Protection, Nitrogen Tires' },
  ownership: {
    monthlyLoan: '500', insurance: '120', fuel: '150',
    maintenance: '75', registration: '30', parking: '0',
    taxesAndFees: '40', other: '0',
  },
  vehicles: {
    needs: { awd: true, appleCarPlay: true },
    comparing: ['camry', 'outback'],
    names: { camry: 'Toyota Camry', outback: 'Subaru Outback', rav4: 'Toyota RAV4' },
    specs: {
      camry: { title: '2025 Toyota Camry LE', msrp: 28595, mpg: 33, seating: 5, drive: 'fwd', safety: 'IIHS Top Safety Pick+' },
      outback: { title: '2025 Subaru Outback Premium', msrp: 32495, mpg: 29, seating: 5, drive: 'awd', safety: 'IIHS Top Safety Pick+' },
    },
  },
  dealScore: {
    input: {},
    result: {
      score: 72,
      breakdown: [
        { label: 'Financing affordability', points: 25, maxPoints: 25, earned: 25, reason: 'fits' },
        { label: 'No unnecessary add-ons', points: 20, maxPoints: 20, earned: 10, reason: 'some' },
      ],
    },
  },
};

const STORAGE_KEY = 'freebuff-car-advisor-state';
// The generated-report marker: a JSON { savedAt } written by the component.
const REPORT_KEY = 'freebuff-car-advisor-report-v1';

test.describe('Intelligence Report generate + download', () => {
  test('generates from a filled session and downloads vehicle-named .md and .txt with correct content', async ({ page }) => {
    // Seed the saved session BEFORE any app script runs, so hydration lands
    // on Step 11 with every payload in place. No report marker is seeded —
    // the report is generated through the real UI below.
    await page.addInitScript(
      ({ state }) => {
        window.localStorage.setItem('freebuff-car-advisor-state', JSON.stringify(state));
      },
      { state: SESSION },
    );

    await page.goto('/advisor');

    // Hydrated to Step 11 with the full session restored — the consent gate
    // (not a generated report) shows because no marker was seeded.
    await expect(page.getByRole('heading', { name: /Intelligence report/i, level: 1 })).toBeVisible();
    // Progress meter counts saved data, not just position: 10 of 11 (all
    // data steps done, report not generated yet). Asserted via the
    // accessible value — the label is split across nested spans in the DOM.
    await expect(page.getByRole('progressbar', { name: 'Advisor progress' })).toHaveAttribute('aria-valuenow', '10');

    // --- Generate through the real UI ---
    // Without the marker the component shows the consent gate first, and
    // Generate is disabled until the disclaimer is checked.
    const generate = page.getByRole('button', { name: /generate report/i });
    await expect(generate).toBeDisabled();
    await page.getByRole('checkbox', { name: /educational guidance/i }).check();
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect(page.getByRole('heading', { name: 'Car Purchase Intelligence Report' })).toBeVisible();

    // --- Persistence: a reload restores the GENERATED view, not the gate ---
    // The component wrote its own { savedAt } marker on generate; nothing is
    // re-seeded here (addInitScript only sets the advisor state), so this
    // proves the marker round-trips through localStorage.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Car Purchase Intelligence Report' })).toBeVisible();

    // The on-screen report renders the computed session figures (engine
    // math, not copies: 27000 financed at 6% for 60mo = $521.99/mo).
    await expect(page.getByText('$522')).toBeVisible();
    await expect(page.getByText('+$3,000')).toBeVisible(); // trade equity 12000 - 9000
    await expect(page.getByText('72')).toBeVisible(); // deal score headline
    await expect(page.getByText(/Documentation fee is above/i)).toBeVisible();

    // Side-by-side comparison table renders the saved Step 2 specs, with
    // the metric winner (Camry: lowest MSRP, highest MPG) marked "Best".
    await expect(page.getByRole('columnheader', { name: 'Toyota Camry' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Subaru Outback' })).toBeVisible();
    await expect(page.getByText('$28,595')).toBeVisible();
    await expect(page.getByText('$32,495')).toBeVisible();
    // Camry wins both metric rows — exactly two Best chips in the table.
    await expect(page.locator('td', { hasText: 'Best' })).toHaveCount(2);

    // --- Download .md: real browser download, real file on disk ---
    const mdPromise = page.waitForEvent('download');
    await page.getByTestId('download-report').click();
    const md = await mdPromise;
    const mdPath = join(tmpdir(), md.suggestedFilename());
    await md.saveAs(mdPath);

    // Vehicle-named filename from the saved Step 2 comparison + names map.
    expect(md.suggestedFilename()).toMatch(
      /^car-purchase-intelligence-report-\d{4}-\d{2}-\d{2}-toyota-camry-subaru-outback\.md$/,
    );
    const mdText = readFileSync(mdPath, 'utf8');
    expect(mdText).toContain('# Car Purchase Intelligence Report');
    expect(mdText).toContain('Monthly payment: $522');
    expect(mdText).toContain('fits within your monthly budget');
    expect(mdText).toContain('Equity: +$3,000');
    expect(mdText).toContain('Estimated total per month: $915');
    expect(mdText).toContain('Documentation fee is above the $150 reference threshold');
    expect(mdText).toContain('72 / 100');
    expect(mdText).toContain('- All-wheel drive');
    expect(mdText).toContain('- Negotiate the out-the-door price first');
    // The comparison table is IN the export — specs, not just filename names.
    expect(mdText).toContain('## Side-by-side comparison');
    expect(mdText).toContain('| MSRP | $28,595 *(best)* | $32,495 |');
    expect(mdText).toContain('| MPG combined | 33 *(best)* | 29 |');
    expect(mdText).toContain('| Drivetrain | FWD | AWD |');

    // --- Download .txt: same session, plain-text syntax ---
    const txtPromise = page.waitForEvent('download');
    await page.getByTestId('download-report-txt').click();
    const txt = await txtPromise;
    const txtPath = join(tmpdir(), txt.suggestedFilename());
    await txt.saveAs(txtPath);

    expect(txt.suggestedFilename()).toMatch(
      /^car-purchase-intelligence-report-\d{4}-\d{2}-\d{2}-toyota-camry-subaru-outback\.txt$/,
    );
    const txtText = readFileSync(txtPath, 'utf8');
    expect(txtText).toContain('CAR PURCHASE INTELLIGENCE REPORT');
    expect(txtText).toContain('Monthly payment: $522');
    expect(txtText).toContain('Equity: +$3,000');
    expect(txtText).toContain('72 / 100');
    // The comparison table is in the plain-text export too (aligned text).
    expect(txtText).toContain('SIDE-BY-SIDE COMPARISON');
    expect(txtText).toContain('$28,595 (best)');
    expect(txtText).toContain('$32,495');
    // Plain text must carry no Markdown syntax.
    expect(txtText).not.toContain('##');
    expect(txtText).not.toContain('**');

    // --- Copy path is wired too (clipboard permission varies by browser) ---
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: /copy report/i }).click();
    await expect(page.getByText('Copied!')).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('Monthly payment: $522');

    // Session still intact after all exports.
    const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || 'null'), STORAGE_KEY);
    expect(stored.step).toBe(11);
    expect(stored.vehicles.comparing).toEqual(['camry', 'outback']);
  });

  test('Step 3 prefills the vehicle price from the first compared vehicle', async ({ page }) => {
    // Same seed as above, but parked ON Step 3 to inspect the form.
    await page.addInitScript(
      ({ state }) => {
        window.localStorage.setItem('freebuff-car-advisor-state', JSON.stringify({ ...state, step: 3 }));
      },
      { state: SESSION },
    );
    await page.goto('/advisor');

    await expect(page.getByRole('heading', { name: /Run the financing math/i })).toBeVisible();

    // Price prefilled from camry's MSRP snapshot (28595), with the chip.
    await expect(page.getByLabel('Vehicle price')).toHaveValue('28595');
    await expect(page.getByTestId('msrp-suggestion')).toContainText('Toyota Camry');

    // The live preview computes from the prefill immediately once down/APR
    // are typed (term defaults to 60): 28595 - 5000 = 23595 financed.
    await page.getByLabel('Down payment').fill('5000');
    await page.getByLabel(/APR/).fill('6');
    await expect(page.getByText('$23,595')).toBeVisible();
    await expect(page.getByText('$456.16')).toBeVisible();

    // Submitting persists the prefilled price into the advisor store.
    await page.getByRole('button', { name: /calculate/i }).click();
    await page.waitForURL(/advisor/);
    const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || 'null'), STORAGE_KEY);
    expect(stored.finance.vehiclePrice).toBe('28595');
    expect(stored.step).toBe(4);
  });
});

test('Step 1 budget funnels into the Step 2 inventory request', async ({ page }) => {
  // Capture the browser's own inventory request.
  let inventoryUrl: string | null = null;
  page.on('request', (req) => {
    if (req.url().includes('/api/inventory')) inventoryUrl = req.url();
  });

  // A Step 1 session with a budget, down payment, and credit tier.
  await page.addInitScript(
    ({ key, state }) => window.localStorage.setItem(key, JSON.stringify(state)),
    {
      key: STORAGE_KEY,
      state: {
        step: 2,
        maxStep: 2,
        consent: true,
        intake: { monthlyBudget: '4500', downPayment: '5000', creditRange: 'good', zip: '60601', bodyStyle: 'suv' },
      },
    },
  );

  await page.goto('/advisor');
  // Keyless environment: the route always answers with demo inventory, whose
  // banner is the deterministic ready-marker.
  await expect(page.getByTestId('demo-banner')).toBeVisible({ timeout: 20_000 });

  // The client must forward the full budget triple to the API, which the
  // server converts into a MarketCheck price_max (key-gated upstream, so the
  // response is demo in CI — the request contract is what's under test).
  expect(inventoryUrl).toBeTruthy();
  const url = new URL(inventoryUrl as string);
  expect(url.searchParams.get('budget')).toBe('4500');
  expect(url.searchParams.get('down')).toBe('5000');
  expect(url.searchParams.get('credit')).toBe('good');

  // Each Step 2 card derives an estimated monthly payment from the Step 1
  // budget inputs. Demo fleet first card: Camry at $28,595, good credit,
  // $5,000 down -> exactly $514/mo over the assumed 60-month term.
  const payments = page.getByTestId('est-payment');
  await expect(payments).toHaveCount(3);
  await expect(payments.first()).toContainText('Est. $514/mo');
  await expect(payments.first()).toContainText('60 mo at 6.5% APR with $5,000 down');
});

test('Over-budget Step 2 cards show a down-payment hint that fits the budget', async ({ page }) => {
  // $500/mo + $5,000 down cannot afford any demo-fleet car at good credit,
  // so every card derives an amber hint. Demo fleet is returned unfiltered,
  // keeping the figures deterministic.
  await page.addInitScript(
    ({ key, state }) => window.localStorage.setItem(key, JSON.stringify(state)),
    {
      key: STORAGE_KEY,
      state: {
        step: 2,
        maxStep: 2,
        consent: true,
        intake: { monthlyBudget: '500', downPayment: '5000', creditRange: 'good', zip: '60601' },
      },
    },
  );

  await page.goto('/advisor');
  await expect(page.getByTestId('demo-banner')).toBeVisible({ timeout: 20_000 });

  const hints = page.getByTestId('down-hint');
  await expect(hints).toHaveCount(3);
  // Camry ($28,595): the exact $100-rounded-up down payment that amortizes
  // to <= $500/mo at 6.5% over 60 months is $5,800.
  await expect(hints.first()).toContainText('About $5,800 down');
  await expect(hints.first()).toContainText('within your $500/mo budget');
});
