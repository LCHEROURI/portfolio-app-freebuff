import { readFile } from 'node:fs/promises';
import path from 'node:path';

// ============================================================================
// Server-side reads of the local scanner feed (data/scans.json).
//
// The file is written by POST /api/scanner in demo mode and overlaid onto the
// live GitHub feed by the cron snapshot (lib/server/reporting/data.ts). This
// helper is shared by surfaces that want per-repo scan freshness — today the
// GET /api/scans route that powers the Settings 'Local scan schedule' card.
// Extracted so tests can mock one small module instead of a Node builtin.
// ============================================================================

export const SCANS_FILE = path.join(process.cwd(), 'data', 'scans.json');

/** Read data/scans.json as an array of raw scan rows; [] when absent/unreadable. */
export const readScansFile = async (): Promise<unknown[]> => {
  const raw = await readFile(SCANS_FILE, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed : [];
};
