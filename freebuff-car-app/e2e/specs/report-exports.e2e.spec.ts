import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { walkAdvisorToGeneratedReport, EXPECTED_SCORE } from '../helpers/advisor';

// End-to-end: after walking the real advisor flow (empty session -> generated
// report), download the .md and .txt exports and assert they carry the SAME
// populated report the on-screen version shows — every section: budget,
// financing math, trade-in, dealer-quote audit (incl. red flags), ownership
// budget, needs, the side-by-side comparison, the negotiation ground rules,
// and the deal-score breakdown (88 / 100 with all five weighted rows) — with
// no "not completed" placeholder. The on-screen component and both exporters
// all read the single saved advisor state, so any divergence between the
// renderings fails here. Expected math for the walk's inputs: financing
// 28595 - 5000 at 6.5%/60mo = $462/mo, $27,700 total; equity 12000 - 9000 =
// +$3,000; ownership defaults = $915/mo; deal score 88 = 25 + 8 + 20 + 20
// + 15.

test.describe.configure({ timeout: 180_000 });

// Engine row labels; export syntax differs by format (`label: earned/max`).
const SCORE_LABELS = [
  'Financing affordability',
  'No unnecessary dealer add-ons',
  'Reasonable documentation fee',
  'Matches customer non-negotiable priorities',
  'Positive trade-in equity / no rollover',
];
const SCORE_ROWS = [
  'Financing affordability: 25/25',
  'No unnecessary dealer add-ons: 8/20',
  'Reasonable documentation fee: 20/20',
  'Matches customer non-negotiable priorities: 20/20',
  'Positive trade-in equity / no rollover: 15/15',
];

// Case/whitespace/punctuation-insensitive canonical form for cross-format
// comparison (the DOM, markdown, and plain text intentionally differ in
// syntax but must carry the same numbers).
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
// Every figure the deal-score breakdown must agree on across ALL renderings:
// the score out of 100, plus each row's label and its earned/max pair.
const DEAL_SCORE_TOKENS = [
  norm(`${EXPECTED_SCORE} / 100`),
  ...SCORE_ROWS.flatMap((row) => {
    const [label, earnedMax] = row.split(': ');
    return [norm(label), norm(earnedMax)];
  }),
];

// Every other section's figures, in report order. Single-column rows use
// `label: value` (contiguous in all four renderings after normalization);
// comparison-table cells use label-only + value-only tokens because columns
// are side-by-side there.
const SECTION_TOKENS = [
  // Section headings themselves.
  'Your budget', 'Financing math', 'Trade-in position', 'Dealer-quote audit',
  'Monthly ownership budget', 'Non-negotiable needs',
  'Side-by-side comparison', 'Deal score', 'Negotiation ground rules',
  // Budget (Step 1)
  'Monthly budget: $600', 'Down payment: $5,000', 'Credit range: good',
  // Financing math (Step 3)
  'Vehicle price: $28,595', 'Amount financed: $23,595',
  'APR / term: 6.5% / 60 mo', 'Monthly payment: $462',
  'Total cost of loan: $27,700', 'fits within your monthly budget',
  // Trade-in (Step 7)
  'Trade-in value: $12,000', 'Loan payoff: $9,000', 'Equity: +$3,000',
  // Dealer-quote audit (Step 8)
  'Documentation fee: $129', 'Title & registration: $345',
  'Add-ons quoted: Fabric Protection, Nitrogen Tires, Glass Etching',
  'High-margin add-on detected: "fabric protection"',
  'High-margin add-on detected: "nitrogen tires"',
  'High-margin add-on detected: "glass etching"',
  // Ownership budget (Step 5)
  'Estimated total per month: $915',
  // Non-negotiable needs (Step 2)
  'All-wheel drive', '5+ seats',
  // Side-by-side comparison (columns render side-by-side, so token the
  // labels and each column's values independently)
  'Est. monthly payment', '514/mo', '598/mo',
  'MSRP', '28,595', '32,495',
  'MPG combined', '33', '29',
  'Seating', '5 seats',
  'Drivetrain', 'FWD', 'AWD',
  'Safety', 'IIHS Top Safety Pick+', 'Best',
  // Negotiation ground rules
  'Negotiate the out-the-door price first — payments last.',
];

const EXPECTED_TOKENS = [
  ...DEAL_SCORE_TOKENS,
  ...SECTION_TOKENS.map((t) => norm(t)),
];

test('the .md and .txt exports carry every report section identically to the screen', async ({ page }) => {
  await walkAdvisorToGeneratedReport(page);

  // Baseline: the on-screen report shows the score and all five rows.
  const body = page.locator('body');
  await expect(body).toContainText(`${EXPECTED_SCORE} / 100`);
  for (const label of SCORE_LABELS) await expect(body).toContainText(label);

  // ---- Download .md (real browser download, real file on disk) ----
  const mdPromise = page.waitForEvent('download');
  await page.getByTestId('download-report').click();
  const md = await mdPromise;
  const mdPath = join(tmpdir(), md.suggestedFilename());
  await md.saveAs(mdPath);
  const mdText = readFileSync(mdPath, 'utf8');

  expect(md.suggestedFilename()).toMatch(
    /^car-purchase-intelligence-report-\d{4}-\d{2}-\d{2}-toyota-camry-subaru-outback\.md$/,
  );
  expect(mdText).toContain('## Deal score');
  expect(mdText).toContain(`**${EXPECTED_SCORE} / 100**`);
  for (const row of SCORE_ROWS) expect(mdText).toContain(`- ${row}`);
  expect(mdText).not.toContain('not completed');

  // ---- Download .txt: same session, plain-text syntax ----
  const txtPromise = page.waitForEvent('download');
  await page.getByTestId('download-report-txt').click();
  const txt = await txtPromise;
  const txtPath = join(tmpdir(), txt.suggestedFilename());
  await txt.saveAs(txtPath);
  const txtText = readFileSync(txtPath, 'utf8');

  expect(txt.suggestedFilename()).toMatch(
    /^car-purchase-intelligence-report-\d{4}-\d{2}-\d{2}-toyota-camry-subaru-outback\.txt$/,
  );
  expect(txtText).toContain('DEAL SCORE');
  expect(txtText).toContain(`${EXPECTED_SCORE} / 100`);
  for (const row of SCORE_ROWS) expect(txtText).toContain(`* ${row}`);
  expect(txtText).not.toContain('not completed');

  // ---- Copy to clipboard: writes the SAME markdown the .md download
  // produced (both call buildReportMarkdown(advisor, savedAt)), so it must
  // equal the .md file byte-for-byte — deal-score breakdown included. ----
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: /copy report/i }).click();
  await expect(page.getByText('Copied!')).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(mdText);
  // Belt and braces: the deal-score section is present in the clipboard text.
  expect(clipboard).toContain('## Deal score');
  expect(clipboard).toContain(`**${EXPECTED_SCORE} / 100**`);
  for (const row of SCORE_ROWS) expect(clipboard).toContain(`- ${row}`);

  // ---- Four-way parity, one spec: screen, .md, .txt, clipboard. The
  // clipboard and .md are both buildReportMarkdown output and were asserted
  // byte-for-byte equal above. The remaining formats deliberately use a
  // different syntax (DOM text, plain text), so their agreement with the
  // others is asserted on the canonical figures — every section heading,
  // figure, and row must appear in all four renderings of this single
  // generation. ----
  const screenText = await page.locator('main').innerText();
  const renderings: Record<string, string> = {
    'on-screen': norm(screenText),
    '.md': norm(mdText),
    '.txt': norm(txtText),
    'clipboard': norm(clipboard),
  };
  for (const [format, text] of Object.entries(renderings)) {
    for (const token of EXPECTED_TOKENS) {
      expect(
        text,
        `${format} rendering is missing report figure "${token}"`,
      ).toContain(token);
    }
  }
});
