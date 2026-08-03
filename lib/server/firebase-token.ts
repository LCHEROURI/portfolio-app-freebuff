import { createVerify, X509Certificate } from 'node:crypto';

// ============================================================================
// Firebase ID token verification (server-only, no firebase-admin dependency).
//
// Firebase Auth ID tokens are RS256 JWTs signed by Google. We verify them the
// same way firebase-admin does: fetch the project's public X509 certificates
// from Google's well-known endpoint (cached), check the standard claims
// (iss/aud/exp/iat), and cryptographically verify the signature with Node's
// built-in crypto. Verified failure → null (fail closed).
//
// Certificates rotate roughly daily, so a short in-memory cache is plenty and
// keeps token verification free of network calls in steady state.
// ============================================================================

const CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const CERT_TTL_MS = 15 * 60 * 1000;

let certCache: { fetchedAt: number; certs: Record<string, string> } | null = null;
// In-flight fetch so concurrent cold-start requests share one call.
let certFetch: Promise<Record<string, string>> | null = null;

const fetchCerts = async (): Promise<Record<string, string>> => {
  const now = Date.now();
  if (certCache && now - certCache.fetchedAt < CERT_TTL_MS) return certCache.certs;
  if (certFetch) return certFetch;
  certFetch = (async () => {
    const res = await fetch(CERTS_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Firebase cert fetch failed (${res.status})`);
    const certs = (await res.json()) as Record<string, string>;
    certCache = { fetchedAt: Date.now(), certs };
    return certs;
  })();
  try {
    return await certFetch;
  } finally {
    certFetch = null;
  }
};

const b64urlToBuffer = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** JWT signature segments are base64url without padding; pad for Node's verify. */
const b64urlToB64 = (value: string): string => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64 + '='.repeat((4 - (base64.length % 4)) % 4);
};

export interface VerifiedToken {
  uid: string;
  email?: string;
}

/**
 * Verify a Firebase ID token for `projectId`. Returns the verified identity,
 * or null when the token is malformed, expired, signed by the wrong issuer,
 * or fails signature verification.
 */
export const verifyFirebaseIdToken = async (
  token: string,
  projectId: string,
): Promise<VerifiedToken | null> => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;

    const header = JSON.parse(b64urlToBuffer(h).toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== 'RS256' || !header.kid) return null;

    const payload = JSON.parse(b64urlToBuffer(p).toString('utf8')) as {
      iss?: string;
      aud?: string;
      exp?: number;
      iat?: number;
      sub?: string;
      email?: string;
    };

    // Standard Firebase ID token claim checks.
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (payload.aud !== projectId) return null;
    // Allow ~1 minute of clock skew (matches firebase-admin) so a server clock
    // running slightly ahead of Google's doesn't spuriously 401 valid tokens.
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now() - 60_000) return null;
    if (typeof payload.iat !== 'number' || payload.iat * 1000 > Date.now() + 5 * 60 * 1000) return null;
    if (!payload.sub) return null;

    const certs = await fetchCerts();
    const certPem = certs[header.kid];
    if (!certPem) return null;

    const publicKey = new X509Certificate(certPem).publicKey;
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${h}.${p}`);
    if (!verifier.verify(publicKey, b64urlToB64(s), 'base64')) return null;

    return {
      uid: String(payload.sub),
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  } catch {
    // Malformed JSON, unknown kid, network failure — treat as unverified.
    return null;
  }
};
