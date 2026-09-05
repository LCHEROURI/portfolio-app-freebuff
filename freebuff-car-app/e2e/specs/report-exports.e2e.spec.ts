import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { walkAdvisorToGeneratedReport, EXPECTED_SCORE } from '../helpers/advisor';

// End-to-end: after walking the real advisor flow (empty session -> generated
// report), download the .md and .txt exports and assert they carry the SAME
// populated deal-score breakdown the on-screen report shows — the score out
// of 100 and each of the five weighted engine rows — with no "not completed"
// placeholder. The report component and both exporters all read the single
// saved `dealScore.result`, so any divergence between the three renderings
// fails here. Expected math for the walk's inputs: 88 = 25 (financing) + 8
// (3 flagged add-ons) + 20 (doc fee) + 20 (priorities) + 15 (equity).

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

test('the .md and .txt exports carry the same populated deal-score breakdown as the screen', async ({ page }) => {
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
  // others is asserted on the canonical figures — every score/earned/max
  // token must appear in all four renderings of this single generation. ----
  const screenText = await page.locator('main').innerText();
  const renderings: Record<string, string> = {
    'on-screen': norm(screenText),
    '.md': norm(mdText),
    '.txt': norm(txtText),
    'clipboard': norm(clipboard),
  };
  for (const [format, text] of Object.entries(renderings)) {
    for (const token of DEAL_SCORE_TOKENS) {
      expect(
        text,
        `${format} rendering is missing deal-score figure "${token}"`,
      ).toContain(token);
    }
  }
});
