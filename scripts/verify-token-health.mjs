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
// The credential resolution, dead-token detection, and their exit-code
// contract are SHARED with verify-deployed-hash.mjs (readToken /
// isInvalidToken / INVALID_TOKEN_MESSAGE / InvalidTokenError are imported,
// not copied) so the two scripts can never drift.
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
// Exports (for the unit test): fetchTokenList, pickActiveToken, formatExpiry,
// expiryVerdict. The shared dead-token helpers (isInvalidToken /
// INVALID_TOKEN_MESSAGE / InvalidTokenError) are imported here, not
// re-exported; the unit test imports them from verify-deployed-hash.mjs
// directly so each surface reflects what it actually uses.
// Read-only against the Vercel API.
// ============================================================================

import { fileURLToPath } from 'node:url';
import {
  INVALID_TOKEN_MESSAGE,
  isInvalidToken,
  readToken,
} from './verify-deployed-hash.mjs';

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
 *
 * Heuristic: the held credential can't be matched to a list row by value (the
 * API never echoes the secret), so we report the newest manual token — exact
 * when the account keeps a single API token (the norm after pruning), and a
 * documented assumption if a second manual token ever exists.
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

/**
 * Pure expiry decision, extracted from main() so it is unit-testable.
 * Returns a verdict object the CLI renders:
 *   { kind: 'none' }                          — no expiry date set
 *   { kind: 'expired',  daysLeft }            — already past expiry
 *   { kind: 'due-soon', daysLeft }            — within the 90-day window
 *   { kind: 'ok',       daysLeft }            — dated but comfortably out
 * Boundary semantics: exactly 90 days out counts as due-soon (<= window),
 * and 0 days out (expiring today) counts as expired since daysLeft < 0 is
 * false only past the exact timestamp. The 90-day window is deliberately a
 * constant so the reminder and its test read from the same source.
 */
export const EXPIRY_WINDOW_DAYS = 90;

export function expiryVerdict(expiresAt, now = Date.now()) {
  if (!expiresAt) return { kind: 'none' };
  const daysLeft = Math.floor((expiresAt - now) / 86_400_000);
  if (daysLeft < 0) return { kind: 'expired', daysLeft };
  if (daysLeft <= EXPIRY_WINDOW_DAYS) return { kind: 'due-soon', daysLeft };
  return { kind: 'ok', daysLeft };
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
  // rotation steps in the README are run before the credential dies. The
  // decision (expired / due-soon / ok / none) lives in the pure expiryVerdict
  // helper so the reminder behavior is unit-testable.
  const verdict = expiryVerdict(active.expiresAt);
  if (verdict.kind === 'expired') {
    // Note: an expired token normally fails the /v2/user/tokens call first, so
    // this branch is defensive (clock skew, a token the API still honors past
    // its date). Keep it as a hard fail regardless.
    console.error(`\n  ✗ EXPIRED ${Math.abs(verdict.daysLeft)} day${Math.abs(verdict.daysLeft) === 1 ? '' : 's'} ago — rotate now (see README → Rotating VERCEL_TOKEN)`);
    console.error('RESULT: FAIL — the active VERCEL_TOKEN is past its expiry date.');
    process.exit(1);
  }
  if (verdict.kind === 'due-soon') {
    console.log(`\n  ⏰ expires in ~${verdict.daysLeft} day${verdict.daysLeft === 1 ? '' : 's'} — rotate soon (see README → Rotating VERCEL_TOKEN)`);
  } else if (verdict.kind === 'ok') {
    console.log(`\n  ✓ expires in ~${verdict.daysLeft} days`);
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
