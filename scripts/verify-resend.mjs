#!/usr/bin/env node
// ============================================================================
// scripts/verify-resend.mjs — prove the stored RESEND_API_KEY is alive and
// can authenticate to the Resend API, so a revoked or mistyped key is caught
// before it silently breaks the Automation Engine's emailed reports.
//
// Reads RESEND_API_KEY from:
//   1. the RESEND_API_KEY env var
//   2. .env.local (RESEND_API_KEY=…)
//
// Probes GET https://api.resend.com/api-keys with the key as a Bearer token
// — a pure, read-only health check that sends no email:
//   - 200                          → full-access key, valid
//   - 401 { name: 'restricted_api_key' } → key is authentic but send-only
//     (Resend restricts it to sending emails) — exactly the permission the
//     Automation Engine needs, so it counts as PASS with a note
//   - 400/401/403 (anything else)  → key is invalid or revoked — exit 2 with
//     the paste-a-fresh-key guidance, mirroring the Vercel token gates'
//     rc=2 contract so the pre-push hook's invalid-credential branch treats
//     it identically
//   - any other status / network  → exit 1 (cannot verify either way)
//
// Usage:
//   npm run verify:resend          # against the stored RESEND_API_KEY
//   node scripts/verify-resend.mjs
//
// Exports (for the unit test): readResendKey, fetchResendKeyStatus,
// classifyResendKey.
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RESEND_BASE = 'https://api.resend.com';

/**
 * Read the stored Resend API key from env, then .env.local (never printed).
 * Returns '' when absent.
 */
export function readResendKey() {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY;
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    const m = env.match(/^RESEND_API_KEY=(.*)$/m);
    return m ? m[1].trim().replace(/^"|"$/g, '') : '';
  } catch {
    return '';
  }
}

/**
 * Probe the Resend key-list endpoint. Returns { res, body } so callers can
 * inspect status and the parsed body — kept as its own function so the unit
 * test can mock fetch and assert the endpoint + auth header.
 */
export async function fetchResendKeyStatus(key, base = RESEND_BASE) {
  const res = await fetch(`${base}/api-keys`, {
    headers: { authorization: `Bearer ${key}` },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => null);
  return { res, body };
}

/**
 * Pure classification of a Resend /api-keys probe, extracted from main() so
 * it is unit-testable:
 *   { kind: 'valid-full' }     — HTTP 200, full-access key
 *   { kind: 'valid-sendonly' } — HTTP 401 + name 'restricted_api_key':
 *                                authentic key restricted to sending emails
 *   { kind: 'invalid' }        — HTTP 400/401/403 otherwise: bad/revoked key
 *   { kind: 'unknown' }        — any other status (e.g. 5xx) — can't verify
 */
export function classifyResendKey(status, body = {}) {
  if (status === 200) return { kind: 'valid-full' };
  if (status === 401 && body?.name === 'restricted_api_key') return { kind: 'valid-sendonly' };
  if (status === 400 || status === 401 || status === 403) return { kind: 'invalid' };
  return {
    kind: 'unknown',
    status,
    detail: typeof body?.message === 'string' ? body.message : '',
  };
}

async function main() {
  const key = readResendKey();
  if (!key) {
    console.error('✗ FAIL: no RESEND_API_KEY (set RESEND_API_KEY or add it to .env.local)');
    process.exit(1);
  }
  if (!key.startsWith('re_')) {
    console.error('✗ FAIL: RESEND_API_KEY does not look like a Resend key (expected re_ prefix)');
    process.exit(1);
  }

  let res;
  let body;
  try {
    ({ res, body } = await fetchResendKeyStatus(key));
  } catch (err) {
    console.error(`✗ FAIL: could not reach the Resend API (${err.message})`);
    process.exit(1);
  }

  const verdict = classifyResendKey(res.status, body);

  console.log('\nResend API key health');
  console.log(`  endpoint  GET /api-keys → HTTP ${res.status}`);

  if (verdict.kind === 'valid-full') {
    console.log('  verdict   key is valid (full access)');
    console.log('\nRESULT: PASS');
    process.exit(0);
  }

  if (verdict.kind === 'valid-sendonly') {
    console.log('  verdict   key is valid — send-only (restricted to sending emails, which is');
    console.log('            exactly what the Automation Engine needs)');
    console.log('\nRESULT: PASS');
    process.exit(0);
  }

  if (verdict.kind === 'invalid') {
    console.error('  verdict   key is invalid or revoked');
    console.error('  fix       create a fresh key at https://resend.com/api-keys, then set it in');
    console.error('            .env.local AND Vercel production (RESEND_API_KEY), and redeploy');
    console.error('\nRESULT: FAIL — the stored RESEND_API_KEY is not accepted by the Resend API.');
    process.exit(2);
  }

  console.error(`  verdict   cannot verify — HTTP ${verdict.status}${verdict.detail ? ` (${verdict.detail})` : ''}`);
  console.error('\nRESULT: FAIL — the Resend API did not answer authoritatively.');
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
