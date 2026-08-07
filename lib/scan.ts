// ============================================================================
// LOCAL SCAN FRESHNESS — shared constants
// ============================================================================
// Single source of truth for the local-repo scanner facts that every surface
// renders: the Command Center strip, the Reports page preview, and the emailed
// daily/weekly report bodies. Keeping the labels and the stale threshold here
// means the surfaces can never drift out of sync with each other.

/** A scanner snapshot older than this is considered stale. */
export const SCAN_STALE_MS = 24 * 3_600_000;

/** Heading label shown by the in-app Local scan strip. */
export const LOCAL_SCAN_TITLE = 'Local scan';

/** Subtitle shown under the in-app heading. */
export const LOCAL_SCAN_SUBTITLE = 'newest → oldest across repos';

/** Section heading used inside the composed daily/weekly report bodies. */
export const LOCAL_SCAN_EMAIL_HEADING = 'Local scan freshness';
