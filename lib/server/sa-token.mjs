// ============================================================================
// Shared service-account credential resolution + JWT→OAuth token mint.
//
// Single source of truth for the Google service-account flow used by:
//   • lib/server/firestoreAdmin.ts   (the automation cron's Firestore reads)
//   • scripts/seed-winner-candidates.mjs (the rule-10 fixture seeder)
//   • scripts/authorize-domain.mjs   (Firebase authorized-domains helper)
//
// Everything reads the same credential source (FIREBASE_SERVICE_ACCOUNT as a
// JSON string, else FIREBASE_SERVICE_ACCOUNT_PATH as a file, else .env.local)
// and mints the same RS256 JWT → OAuth access token, so the three flows can
// never drift apart. Plain ESM on purpose: importable from server TS (via
// allowJs) and from standalone .mjs CLI scripts alike.
// ============================================================================

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// The one shared quote-stripping implementation (scripts/local-env.mjs). A
// vercel env pull writes .env.local values in quoted form; every gate that
// read them with its own regex once forgot the quotes — gate 3's IdP checks
// and the Firestore probe both broke that way. Keep readEnv's own resolution
// (env → .env.local) but strip via the tested helper so the logic exists once.
import { stripQuotes } from '../../scripts/local-env.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Read an env var from process.env, falling back to .env.local for CLI runs. */
const readEnv = (name) => {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const m = env.match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? stripQuotes(m[1]) : undefined;
  } catch {
    return undefined;
  }
};

/** The raw service-account JSON string ('' when not configured). */
export const getServiceAccount = () => {
  const direct = readEnv('FIREBASE_SERVICE_ACCOUNT');
  if (direct) return direct;
  const path = readEnv('FIREBASE_SERVICE_ACCOUNT_PATH');
  if (path) {
    try {
      return readFileSync(resolve(process.cwd(), path), 'utf8');
    } catch {
      return '';
    }
  }
  return '';
};

/** The Firestore project id (NEXT_PUBLIC_FIREBASE_PROJECT_ID, else server one). */
export const getProjectId = () =>
  readEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID') ?? readEnv('FIREBASE_PROJECT_ID') ?? '';

/** True when both the service account and a project id resolve. */
export const isServiceAccountConfigured = () => Boolean(getServiceAccount() && getProjectId());

// Cached OAuth access token (~55 min, well under the 1h token lifetime).
let cached = null;

/**
 * Mint (and cache) a Google OAuth access token from the service-account key.
 * @param {string} [saRawOverride] optional raw SA JSON (CLI --service-account)
 * @returns {Promise<string>} OAuth bearer token
 */
export const mintServiceAccountToken = async (saRawOverride) => {
  if (cached && cached.exp > Date.now() + 5 * 60_000) return cached.token;
  const raw = saRawOverride ?? getServiceAccount();
  if (!raw) {
    throw new Error('Firestore admin not configured (FIREBASE_SERVICE_ACCOUNT missing).');
  }
  const sa = JSON.parse(raw) || {};

  const b64url = (buf) => Buffer.from(buf).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const sig = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key, 'base64url');
  const assertion = `${header}.${claims}.${sig}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) || {};
  if (!res.ok || !json.access_token) {
    throw new Error(`Firestore token mint failed (${res.status}).`);
  }
  cached = { token: json.access_token, exp: Date.now() + 55 * 60_000 };
  return json.access_token;
};
