// Report export builders for the Intelligence Report. Pure and unit-testable.
// The session data is extracted ONCE into a neutral structure; the Markdown
// and plain-text renderers are thin syntax passes over it, so the two file
// formats can never disagree with each other or with the on-screen report
// (both reuse the same business utils: loan calculators, red-flag engine).
import { monthlyPayment, totalCost } from '@/utils/financeCalculators';
import { docFeeFlags, addOnFlags } from '@/utils/redFlags';
import type { AdvisorState } from '@/hooks/useAdvisorState';

function parseNumber(value: unknown): number {
  const n = Number(value);
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function usd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function str(state: Record<string, unknown> | undefined, key: string): string {
  const v = state?.[key];
  return typeof v === 'string' ? v : '';
}

function rec(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

const NEED_LABELS: Record<string, string> = {
  awd: 'All-wheel drive',
  seating5plus: '5+ seats',
  highFuelEconomy: '30+ MPG combined',
  topSafetyPick: 'IIHS Top Safety Pick+',
  appleCarPlay: 'Apple CarPlay',
  androidAuto: 'Android Auto',
};

export interface ReportSection {
  title: string;
  completed: boolean;
  /** Step number shown in the not-completed marker. */
  step?: string;
  /** Prominent non-bullet line (deal score headline). */
  headline?: string;
  /** Bullet items, plain text (renderers add their own bullet syntax). */
  items: string[];
  /** Emphasized sub-block (e.g. red flags). */
  sub?: { heading: string; items: string[] };
  /** Trailing plain note (e.g. comparison count). */
  footnote?: string;
}

/** One compared vehicle's spec column (from the Step 2 specs snapshot). */
export interface CompareColumn {
  /** Short label, from the names snapshot ("Toyota Camry"). */
  label: string;
  msrp: number | null;
  /** Combined MPG; null when unknown — rendered as "n/a", never fabricated. */
  mpg: number | null;
  seating: number | null;
  drive: string;
  safety: string;
}

/** The five spec rows every comparison shows, in order. */
export function compareRowValues(c: CompareColumn): { label: string; value: string }[] {
  return [
    { label: 'MSRP', value: c.msrp === null ? 'n/a' : usd(c.msrp) },
    { label: 'MPG combined', value: c.mpg === null ? 'n/a' : `${c.mpg}` },
    { label: 'Seating', value: c.seating === null ? 'n/a' : `${c.seating} seats` },
    { label: 'Drivetrain', value: c.drive || 'n/a' },
    { label: 'Safety', value: c.safety || 'n/a' },
  ];
}

/**
 * Extract the compared vehicles' spec columns from the Step 2 store slice.
 * Shared by the on-screen report and the .md/.txt exporters so the three
 * renderings cannot disagree. Vehicles without a saved spec (sessions saved
 * before snapshots existed) render as all-n/a columns instead of vanishing.
 */
export function buildCompareColumns(
  vehicles: Record<string, unknown> | null | undefined,
): CompareColumn[] {
  const comparing = vehicles?.comparing;
  if (!Array.isArray(comparing)) return [];
  const names = rec(vehicles?.names);
  const specs = rec(vehicles?.specs);
  return (comparing as string[]).map((id) => {
    const label = typeof names?.[id] === 'string' && names[id].trim() !== '' ? names[id] : id;
    const spec = rec(specs?.[id]);
    const num = (v: unknown): number | null => {
      const n = Number(v);
      return v !== undefined && v !== null && Number.isFinite(n) ? n : null;
    };
    return {
      label,
      msrp: num(spec?.msrp),
      mpg: num(spec?.mpg),
      seating: num(spec?.seating),
      drive: typeof spec?.drive === 'string' ? spec.drive.toUpperCase() : '',
      safety: typeof spec?.safety === 'string' ? spec.safety : '',
    };
  });
}

interface ReportData {
  sections: ReportSection[];
  rules: string[];
  /** Side-by-side spec comparison (Step 2 snapshot); empty when none. */
  compare: CompareColumn[];
}

function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Filesafe slugs for the compared vehicles (max = the compare cap of 3). */
function comparedVehicleSlugs(advisor: AdvisorState | null | undefined): string[] {
  const vehicles = rec((advisor as { vehicles?: unknown } | null | undefined)?.vehicles);
  const comparing = Array.isArray(vehicles?.comparing) ? (vehicles?.comparing as string[]) : [];
  if (comparing.length === 0) return [];
  const names = rec(vehicles?.names);
  const slugs: string[] = [];
  for (const id of comparing.slice(0, 3)) {
    const label = typeof names?.[id] === 'string' && names[id].trim() !== '' ? names[id] : id;
    const slug = sanitizeSlug(label);
    // Skip ids that sanitize to pure numbers (live-feed ids carry no name).
    if (slug.length > 0 && !/^\d+$/.test(slug)) slugs.push(slug.slice(0, 24));
  }
  return slugs;
}

export function reportFileName(
  savedAt: string | null | undefined,
  ext: 'md' | 'txt' = 'md',
  advisor?: AdvisorState | null,
): string {
  const day = (savedAt ?? new Date().toISOString()).slice(0, 10);
  const base = `car-purchase-intelligence-report-${day}`;
  const slugs = comparedVehicleSlugs(advisor);
  return slugs.length > 0 ? `${base}-${slugs.join('-')}.${ext}` : `${base}.${ext}`;
}

/** Extract every section's content from the store — no format syntax here. */
export function buildReportData(advisor: AdvisorState | null | undefined): ReportData {
  const s = rec(advisor);
  const sections: ReportSection[] = [];

  // Budget (Step 1)
  const intake = rec(s?.intake);
  const budget = parseNumber(intake?.monthlyBudget);
  sections.push({
    title: 'Your budget',
    completed: budget > 0,
    step: '1',
    items:
      budget > 0
        ? [
            `Monthly budget: ${usd(budget)}`,
            ...(parseNumber(intake?.downPayment) > 0 ? [`Down payment: ${usd(parseNumber(intake?.downPayment))}`] : []),
            ...(str(intake, 'creditRange') ? [`Credit range: ${str(intake, 'creditRange')}`] : []),
          ]
        : [],
  });

  // Financing (Step 3)
  const finance = rec(s?.finance);
  const hasFinance = !!finance && str(finance, 'vehiclePrice').trim() !== '';
  const financeItems: string[] = [];
  if (hasFinance) {
    const price = parseNumber(finance?.vehiclePrice);
    const down = parseNumber(finance?.downPayment);
    const apr = parseNumber(finance?.apr);
    const term = parseNumber(finance?.termMonths);
    const principal = Math.max(0, price - down);
    const payment = monthlyPayment(principal, apr, term);
    financeItems.push(`Vehicle price: ${usd(price)}`);
    financeItems.push(`Amount financed: ${usd(principal)}`);
    financeItems.push(`APR / term: ${apr}% / ${term} mo`);
    financeItems.push(
      `Monthly payment: ${usd(payment)}${budget > 0 ? (payment <= budget ? ' — fits within your monthly budget.' : ' — OVER your monthly budget; renegotiate or pick a cheaper vehicle.') : ''}`,
    );
    financeItems.push(`Total cost of loan: ${usd(totalCost(principal, apr, term))}`);
  }
  sections.push({ title: 'Financing math', completed: hasFinance, step: '3', items: financeItems });

  // Trade (Step 7)
  const trade = rec(s?.trade);
  const hasTrade = !!trade && (str(trade, 'tradeValue').trim() !== '' || str(trade, 'payoff').trim() !== '');
  const tradeItems: string[] = [];
  if (hasTrade) {
    const value = parseNumber(trade?.tradeValue);
    const payoff = parseNumber(trade?.payoff);
    const equity = value - payoff;
    tradeItems.push(`Trade-in value: ${usd(value)}`);
    tradeItems.push(`Loan payoff: ${usd(payoff)}`);
    tradeItems.push(`Equity: ${equity >= 0 ? '+' : ''}${usd(equity)}${equity < 0 ? ' — negative equity; avoid rolling it into the new loan.' : ''}`);
  }
  sections.push({ title: 'Trade-in position', completed: hasTrade, step: '7', items: tradeItems });

  // Dealer-quote audit (Step 8)
  const fees = rec(s?.fees);
  const hasFees = !!fees && str(fees, 'docFee').trim() !== '';
  const feeItems: string[] = [];
  let feeSub: ReportSection['sub'];
  if (hasFees) {
    const docFee = parseNumber(fees?.docFee);
    feeItems.push(`Documentation fee: ${usd(docFee)}`);
    feeItems.push(`Title & registration: ${usd(parseNumber(fees?.titleRegistration))}`);
    const addOnList = str(fees, 'addOnsText').split(',').map((a) => a.trim()).filter(Boolean);
    if (addOnList.length > 0) feeItems.push(`Add-ons quoted: ${addOnList.join(', ')}`);
    const flags = [...docFeeFlags(docFee), ...addOnFlags(addOnList)];
    if (flags.length > 0) {
      feeSub = { heading: 'Red flags:', items: flags.map((flag) => flag.label) };
    } else {
      feeItems.push('No red flags detected in this quote.');
    }
  }
  sections.push({ title: 'Dealer-quote audit', completed: hasFees, step: '8', items: feeItems, sub: feeSub });

  // Ownership budget (Step 5)
  const ownership = rec(s?.ownership);
  const ownKeys = ['monthlyLoan', 'insurance', 'fuel', 'maintenance', 'registration', 'parking', 'taxesAndFees', 'other'];
  const ownValues = ownership ? ownKeys.map((k) => parseNumber(ownership[k])) : [];
  const hasOwnership = ownValues.some((v) => v !== 0);
  sections.push({
    title: 'Monthly ownership budget',
    completed: hasOwnership,
    step: '5',
    items: hasOwnership ? [`Estimated total per month: ${usd(ownValues.reduce((a, b) => a + b, 0))}`] : [],
  });

  // Needs (Step 2)
  const vehicles = rec(s?.vehicles);
  const needs = rec(vehicles?.needs);
  const activeNeeds = needs ? Object.entries(needs).filter(([, v]) => v).map(([k]) => NEED_LABELS[k] ?? k) : [];
  const comparing = vehicles?.comparing;
  const comparingCount = Array.isArray(comparing) ? comparing.length : 0;
  sections.push({
    title: 'Non-negotiable needs',
    completed: activeNeeds.length > 0,
    step: '2',
    items: activeNeeds,
    footnote: comparingCount > 0 ? `${comparingCount} vehicle${comparingCount === 1 ? '' : 's'} marked for comparison.` : undefined,
  });

  // Side-by-side comparison (Step 2 specs snapshot)
  const compare = buildCompareColumns(vehicles);

  // Deal score (Step 10)
  const dealScore = rec(s?.dealScore);
  const result = rec(dealScore?.result);
  const hasScore = !!result && result.score !== undefined;
  const breakdown = result && Array.isArray(result.breakdown)
    ? (result.breakdown as { label: string; earned: number; maxPoints: number }[])
    : [];
  sections.push({
    title: 'Deal score',
    completed: hasScore,
    step: '10',
    headline: hasScore ? `${parseNumber(result?.score)} / 100` : undefined,
    items: breakdown.map((item) => `${item.label}: ${item.earned}/${item.maxPoints}`),
  });

  return {
    sections,
    compare,
    rules: [
      'Negotiate the out-the-door price first — payments last.',
      'Get every number in writing before discussing financing.',
      'Decline high-margin add-ons; they are optional, not required.',
      'Walking away is your strongest move, and it costs nothing.',
    ],
  };
}

function generatedAtLine(savedAt: string | null | undefined): string {
  return savedAt ? new Date(savedAt).toLocaleString() : new Date().toLocaleString();
}

const DISCLAIMER = 'Educational guidance based on the numbers you entered — not financial advice.';

export function buildReportMarkdown(
  advisor: AdvisorState | null | undefined,
  savedAt: string | null | undefined,
): string {
  const data = buildReportData(advisor);
  const lines: string[] = [];

  lines.push('# Car Purchase Intelligence Report');
  lines.push('');
  lines.push(`_Generated by Buy Smart with Larry · ${generatedAtLine(savedAt)}_`);
  lines.push('');
  lines.push(`> ${DISCLAIMER}`);
  lines.push('');

  for (const section of data.sections) {
    lines.push(`## ${section.title}`);
    if (!section.completed && section.step) {
      lines.push(`> Step ${section.step} not completed yet.`);
    }
    if (section.headline) {
      lines.push(`**${section.headline}**`);
      if (section.items.length > 0) lines.push('');
    }
    for (const item of section.items) lines.push(`- ${item}`);
    if (section.sub) {
      lines.push('');
      lines.push(`**${section.sub.heading}**`);
      for (const item of section.sub.items) lines.push(`- ${item}`);
    }
    if (section.footnote) {
      lines.push('');
      lines.push(section.footnote);
    }
    lines.push('');
  }

  // Side-by-side comparison — a real Markdown table.
  if (data.compare.length > 0) {
    lines.push('## Side-by-side comparison');
    const rows = compareRowValues(data.compare[0]);
    lines.push(`| Spec | ${data.compare.map((c) => c.label).join(' | ')} |`);
    lines.push(`| ${['---', ...data.compare.map(() => '---')].join(' | ')} |`);
    for (const row of rows) {
      lines.push(`| ${row.label} | ${data.compare.map((c) => compareRowValues(c).find((r) => r.label === row.label)?.value ?? '').join(' | ')} |`);
    }
    lines.push('');
  }

  lines.push('## Negotiation ground rules');
  for (const rule of data.rules) lines.push(`- ${rule}`);
  lines.push('');

  return lines.join('\n');
}

export function buildReportPlainText(
  advisor: AdvisorState | null | undefined,
  savedAt: string | null | undefined,
): string {
  const data = buildReportData(advisor);
  const lines: string[] = [];

  lines.push('CAR PURCHASE INTELLIGENCE REPORT');
  lines.push('================================');
  lines.push(`Generated by Buy Smart with Larry · ${generatedAtLine(savedAt)}`);
  lines.push(DISCLAIMER);
  lines.push('');

  for (const section of data.sections) {
    lines.push(section.title.toUpperCase());
    lines.push('-'.repeat(Math.max(section.title.length, 10)));
    if (!section.completed && section.step) {
      lines.push(`>> Step ${section.step} not completed yet.`);
    }
    if (section.headline) lines.push(section.headline);
    for (const item of section.items) lines.push(`* ${item}`);
    if (section.sub) {
      lines.push('');
      lines.push(section.sub.heading.toUpperCase());
      for (const item of section.sub.items) lines.push(`* ${item}`);
    }
    if (section.footnote) lines.push(section.footnote);
    lines.push('');
  }

  // Side-by-side comparison — aligned plain text (no Markdown syntax).
  if (data.compare.length > 0) {
    lines.push('SIDE-BY-SIDE COMPARISON');
    lines.push('-----------------------');
    const rowDefs = compareRowValues(data.compare[0]);
    // Column width = widest cell in that column (label or any row value),
    // floored at 12, plus 2 spaces of gutter so columns never abut —
    // including the spec-label column itself.
    const widthOf = (i: number) =>
      Math.max(
        12,
        data.compare[i].label.length,
        ...rowDefs.map((r) => (compareRowValues(data.compare[i]).find((x) => x.label === r.label)?.value ?? '').length),
      ) + 2;
    const labelWidth = Math.max(12, ...rowDefs.map((r) => r.label.length)) + 2;
    lines.push(
      'Spec'.padEnd(labelWidth) + data.compare.map((c, i) => c.label.padEnd(widthOf(i))).join(''),
    );
    for (const row of rowDefs) {
      lines.push(
        row.label.padEnd(labelWidth) +
          data.compare
            .map((c, i) => (compareRowValues(c).find((r) => r.label === row.label)?.value ?? '').padEnd(widthOf(i)))
            .join(''),
      );
    }
    lines.push('');
  }

  lines.push('NEGOTIATION GROUND RULES');
  lines.push('------------------------');
  for (const rule of data.rules) lines.push(`* ${rule}`);
  lines.push('');

  return lines.join('\n');
}
