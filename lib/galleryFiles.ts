import galleryCells from '@/lib/gallery-cells.json';

// The 18 canonical gallery files, derived from the single source of truth
// (lib/gallery-cells.json) shared with the /gallery page and the capture
// driver, so the allowlist can never drift from the captured cells.
export const GALLERY_FILE_NAMES: string[] = galleryCells.flatMap(({ route }) => [
  `${route}.png`,
  `${route}-dark.png`,
]);
