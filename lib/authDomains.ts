// ============================================================================
// Firebase authorized-domains matching.
// Firebase's sign-in gate compares the app's origin hostname against the
// project's Authorized domains list (Identity Toolkit getProjectConfig). This
// is the same comparison the AuthGate surfaces after a failed attempt; the
// status panel runs it proactively so a missing domain is flagged before the
// user ever hits the sign-in screen.
// ============================================================================

/** Extract the hostname from an origin, tolerating a trailing dot and ports. */
export const originHostname = (origin: string): string => {
  try {
    return new URL(origin).hostname.replace(/\.$/, '');
  } catch {
    return origin.replace(/\.$/, '');
  }
};

/** True when the origin's hostname appears in the project's authorized list. */
export const isDomainAuthorized = (
  authorizedDomains: string[],
  origin: string,
): boolean => {
  const host = originHostname(origin).toLowerCase();
  return authorizedDomains.some(
    (d) => d.trim().toLowerCase().replace(/\.$/, '') === host,
  );
};
