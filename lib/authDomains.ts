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

/**
 * Normalize a `?project=` override value into an origin string, or null when
 * it can't be used. Accepts a full URL (scheme, port, path tolerated) or a
 * bare hostname (scheme assumed to be https); `localhost` is allowed. This
 * lets the status check validate a deployment preview domain BEFORE it ships
 * — the check evaluates the override hostname against the project's
 * authorized list instead of the current request origin.
 */
export const normalizeProjectOrigin = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    const host = url.hostname.replace(/\.$/, '');
    // A usable origin hostname must be localhost or contain a dot; bare
    // single-label values (e.g. "foo") can't resolve to a real domain.
    if (!host || (!host.includes('.') && host !== 'localhost')) return null;
    return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return null;
  }
};
