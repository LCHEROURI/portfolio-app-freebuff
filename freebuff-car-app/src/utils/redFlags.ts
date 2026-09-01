/**
 * Red-flag rules for dealer quotes.
 *
 * Doc fee threshold: $150 (per the source blueprint in the build manual).
 */
const DOC_FEE_THRESHOLD = 150;

export const HIGHLAND_ADD_ONS = [
  'paint and fabric protection',
  'fabric protection',
  'paint protection',
  'nitrogen tires',
  'nitrogen tire fill',
  'glass etching',
  'window etching',
  'etching',
  'anti-theft etching',
  'key protect',
  'vehicle protection package',
  'protection package',
  'premium protection',
] as const;

export type RedFlag = {
  type: 'docFee' | 'addOn';
  label: string;
  value: number | string;
  threshold?: number;
};

/**
 * Returns red flags for a documentation fee.
 */
export function docFeeFlags(docFee: number): RedFlag[] {
  if (docFee <= 0) return [];
  if (docFee > DOC_FEE_THRESHOLD) {
    return [
      {
        type: 'docFee',
        label: 'Documentation fee is above the $150 reference threshold',
        value: docFee,
        threshold: DOC_FEE_THRESHOLD,
      },
    ];
  }
  return [];
}

/**
 * Returns red flags for add-ons.
 *
 * Normalize against common high-margin dealer add-ons. Inputs are matched
 * case-insensitively and after trimming.
 */
export function addOnFlags(addOns: string[]): RedFlag[] {
  const flags: RedFlag[] = [];
  const normalized = addOns.map((a) => a.trim().toLowerCase());

  for (const addOn of normalized) {
    if (addOn.length === 0) continue;
    for (const pattern of HIGHLAND_ADD_ONS) {
      if (addOn.includes(pattern)) {
        flags.push({
          type: 'addOn',
          label: `High-margin add-on detected: "${addOn}"`,
          value: addOn,
        });
        break;
      }
    }
  }

  return flags;
}

/**
 * Combined red-flag scan for a dealer quote.
 */
export function quoteRedFlags(
  docFee: number,
  addOns: string[],
): RedFlag[] {
  return [...docFeeFlags(docFee), ...addOnFlags(addOns)];
}
