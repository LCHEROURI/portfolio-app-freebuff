// ============================================================================
// scripts/verify-all-subresults.mjs — VERIFY-SUBRESULT marker contract.
//
// verify-all.mjs runs each gate as a child process and, for "capture" gates,
// scans their piped stdout for machine-readable sub-result markers:
//
//   VERIFY-SUBRESULT|<name>|<PASS|FAIL>
//
// Each marker becomes its own indented row under the parent gate's row in the
// summary table. This module owns that contract so it can be unit-tested in
// isolation: a gate that emits a malformed line (wrong segment count, a
// non-PASS/FAIL verdict, trailing junk) has that line silently ignored, and an
// unknown marker name falls back to its raw name rather than a stale label.
//
// Read-only against the working tree; no imports, no side effects.
// ============================================================================

// Sub-result labels: the marker name a gate emits → the friendly row label
// shown in the summary table. Unknown names fall back to the raw marker name.
export const SUBRESULT_LABELS = {
  'auth-gate': 'Unauthenticated 401 gate',
  'secret-drift': 'Deployed CRON_SECRET matches local',
  'weekly-body': 'Weekly body: heading + footer',
  'daily-body': 'Daily body: narration + footer',
  'email-envelope-sweep': 'Email-envelope sweep',
  'portfolio-write-read': 'Portfolio write/read',
  'cross-user-denied': 'Cross-user write denied',
  'authgate-render': 'AuthGate renders',
  'provider-ui': 'Provider controls render (email + Google button)',
  'email-idp-config': 'Email/Password IdP config (admin)',
  'google-idp-config': 'Google IdP [3b] config + OAuth client (admin)',
  'signin-release': 'Sign-in releases into shell',
  'firestore-sync': 'Firestore sync',
  'sdk-surface': 'SDK createAuthUri surface',
  'admin-config': 'Admin API IdP config',
  'review-sheet-preview': 'Review-sheet preview window renders',
  'review-sheet-entries': 'Both numbered recommendations listed',
  'review-sheet-model-label': 'Friendly model label rendered',
  'token-active': 'Vercel token resolves + valid',
  'expiry-verdict': 'Token expiry verdict',
  'alias-drift': 'Alias-routing drift watch',
  'expect-match': 'Deployed sha matches --expect',
  'check-local': 'Local HEAD matches deployed',
};

// The exact marker shape a gate may emit. Anything else on the line is
// ignored — this regex IS the contract a test locks against.
const MARKER_RE = /^VERIFY-SUBRESULT\|([^|]+)\|(PASS|FAIL)\s*$/;

/**
 * Parse VERIFY-SUBRESULT markers out of a gate's captured stdout.
 * Returns an array of { name, label, pass } sub-result entries, one per valid
 * marker line, in emission order. Malformed lines are skipped (never a crash,
 * never a partial row). Unknown marker names keep their raw name as the label.
 *
 * @param {string} captured   The gate's piped stdout (may be '' or undefined).
 * @param {string} gateName   The parent gate's name, prefixed to each marker.
 * @param {Record<string,string>} [labels] Label map; defaults to SUBRESULT_LABELS.
 * @returns {Array<{name: string, label: string, pass: boolean}>}
 */
export function parseSubResultMarkers(captured, gateName, labels = SUBRESULT_LABELS) {
  const rows = [];
  for (const line of (captured ?? '').split('\n')) {
    const m = line.match(MARKER_RE);
    if (!m) continue;
    rows.push({
      name: `${gateName}/${m[1]}`,
      label: `  ↳ ${labels[m[1]] ?? m[1]} (deployed)`,
      pass: m[2] === 'PASS',
    });
  }
  return rows;
}
