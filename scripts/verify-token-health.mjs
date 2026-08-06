#!/usr/bin/env node
// ============================================================================
// scripts/verify-token-health.mjs — prove the VERCEL_TOKEN in use is alive and
// report its name and expiry as recorded by Vercel, so a revoked or expiring
// credential is caught before it silently breaks a deploy or CI gate.
//
// Reads VERCEL_TOKEN from:
//   1. the VERCEL_TOKEN env var
//   2. .env.local (VERCEL_TOKEN=…)
//   3. the Vercel CLI auth store (~/Library/Application Support/
//      com.vercel.cli/auth.json) — the fallback that keeps local runs working
//      before a durable token is pasted into .env.local
//
// Checks the token against GET /v2/user/tokens (the same endpoint the account
// tokens page reads): a dead/revoked token is flagged invalidToken:true and the
// script exits 2 with the paste-a-fresh-token guidance — the same exit-code
// contract as verify-deployed-hash.mjs, so the pre-push hook's rc=2 branch
// handles both identically. On success it reports the most recent manually
// created token's name + expiry (that is the durable access token the local
// credential corresponds to) and prints a 90-day reminder when it is due to
// expire.
//
// Usage:
//   npm run verify:token-health          # against the stored VERCEL_TOKEN
//   node scripts/verify-token-health.mjs
//
// Exports (for the unit test): isInvalidToken, INVALID_TOKEN_MESSAGE,
// InvalidTokenError, fetchTokenList, pickActiveToken.
// Read-only against the Vercel API.
// ============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/** The targeted failure message for a dead VERCEL_TOKEN (no "✗ FAIL: " prefix). */
export const INVALID_TOKEN_MESSAGE =
  'VERCEL_TOKEN is invalid or revoked — paste a fresh token from https://vercel.com/account/tokens into .env.local';

/**
 * Vercel marks a dead/revoked credential by returning invalidToken: true in
 * the error body (typically a 401 or 403). Detect it so callers can show the
 * targeted 'paste a fresh token' guidance instead of a generic HTTP status
 * message — and so the pre-push hook can skip its pointless retry.
 */
export function isInvalidToken(body) {
  return Boolean(body && (body.invalidToken === true || body?.error?.invalidToken === true));
}

/** Error used to signal a dead token distinctly from a generic API failure. */
export class InvalidTokenError extends Error {
  constructor() {
    super(INVALID_TOKEN_MESSAGE);
    this.name = 'InvalidTokenError';
  }
}

// ── Token resolution (same precedence as verify-deployed-hash.mjs) ──────────
const readToken = () => {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const m = env.match(/^VERCEL_TOKEN=(.*)$/m);
    if (m) return m[1].trim().replace(/^"|"$/g, '');
  } catch { /* no .env.local */ }
  try {
    const auth = readFileSync(
      resolve(homedir(), 'Library/Application Support/com.vercel.cli/auth.json'),
      'utf8',
    );
    const parsed = JSON.parse(auth);
    if (parsed.token) return parsed.token;
  } catch { /* no CLI store */ }
  return null;
};

/**
 * Fetch the account's token list. Returns the Response so callers can inspect
 * status and the parsed body — kept as its own function so the unit test can
 * mock fetch and assert the endpoint + auth header without driving main().
 */
export async function fetchTokenList(token, base = 'https://api.vercel.com') {
  const res = await fetch(`${base}/v2/user/tokens`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  return { res, body };
}

/**
 * Pick the token to report on: the most recently created token with
 * origin "manual" (an API access token like the one in .env.local), not the
 * website-login session tokens (origin email/google/github).
 */
export function pickActiveToken(tokens = []) {
  const manual = tokens.filter((t) => t.origin === 'manual');
  if (manual.length === 0) return null;
  return manual.reduce((a, b) => ((a.createdAt ?? 0) >= (b.createdAt ?? 0) ? a : b));
}

/** Format an epoch-ms expiresAt as YYYY-MM-DD, or 'no expiration'. */
export function formatExpiry(expiresAt) {
  if (!expiresAt) return 'no expiration';
  return new Date(expiresAt).toISOString().slice(0, 10);
}

async function main() {
  const token = readToken();
  if (!token) {
    console.error('✗ FAIL: no VERCEL_TOKEN (set VERCEL_TOKEN, add it to .env.local, or run vercel login)');
    process.exit(1);
  }

  let res;
  let body;
  try {
    ({ res, body } = await fetchTokenList(token));
  } catch (err) {
    console.error(`✗ FAIL: could not reach the Vercel API (${err.message})`);
    process.exit(1);
  }

  if (!res.ok) {
    if (isInvalidToken(body)) {
      console.error(`✗ FAIL: ${INVALID_TOKEN_MESSAGE}`);
      process.exit(2);
    }
    console.error(`✗ FAIL: Vercel API returned HTTP ${res.status}.`);
    process.exit(1);
  }

  const active = pickActiveToken(body?.tokens ?? []);
  if (!active) {
    console.error('✗ FAIL: no manually created Vercel API token found on this account (only website-login sessions).');
    process.exit(1);
  }

  const expiry = formatExpiry(active.expiresAt);
  console.log('\nVercel token health');
  console.log(`  name    ${active.name ?? '(unnamed)'}`);
  console.log(`  created ${active.createdAt ? formatExpiry(active.createdAt) : 'unknown'}`);
  console.log(`  expires ${expiry}`);

  // A 90-day reminder: even a no-expiration token can be revoked by account
  // changes, but a DATED token is on a real clock — surface it early so the
  // rotation steps in the README are run before the credential dies.
  if (active.expiresAt) {
    const daysLeft = Math.floor((active.expiresAt - Date.now()) / 86_400_000);
    if (daysLeft <= 90) {
      console.log(`\n  ⏰ expires in ~${Math.max(daysLeft, 0)} day${daysLeft === 1 ? '' : 's'} — rotate soon (see README → Rotating VERCEL_TOKEN)`);
    } else {
      console.log(`\n  ✓ expires in ~${daysLeft} days`);
    }
  } else {
    console.log('\n  ✓ no expiration — but account changes can still revoke it (the invalid/revoked check guards this)');
  }

  console.log('\nRESULT: PASS');
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
