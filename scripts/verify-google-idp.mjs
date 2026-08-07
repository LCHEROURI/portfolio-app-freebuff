#!/usr/bin/env node
// ============================================================================
// scripts/verify-google-idp.mjs — production Google sign-in IdP smoke check.
//
// Asserts the SDK surface the Google popup actually reads: accounts:createAuthUri
// with providerId google.com must resolve and embed a classic web client id.
// (The older v3 getProjectConfig idpConfig array is empty on this project even
// when the provider is enabled, so it cannot gate sign-in.) Also cross-checks
// the admin API (via the shared SA mint) so the config store and the SDK
// surface agree.
//
// Usage:
//   node scripts/verify-google-idp.mjs
//
// Reads FIREBASE_WEB_API_KEY, then NEXT_PUBLIC_FIREBASE_API_KEY, then
// .env.local; project id from NEXT_PUBLIC_FIREBASE_PROJECT_ID / .env.local.
// Exits nonzero on any failure. No Chrome required — fast, CI-friendly.
// ============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getServiceAccount, mintServiceAccountToken } from '../lib/server/sa-token.mjs';

const readEnv = (name) => {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const m = env.match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^"|"$/g, '') : undefined;
  } catch {
    return undefined;
  }
};

const API_KEY =
  process.env.FIREBASE_WEB_API_KEY ??
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
  readEnv('NEXT_PUBLIC_FIREBASE_API_KEY') ??
  '';

const PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? readEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID') ?? '';

let failures = 0;
// Per-section failure counts so the end-of-run VERIFY-SUBRESULT markers (which
// verify-all.mjs renders as indented sub-rows in the summary table) reflect
// each sub-check independently instead of one global pass/fail.
const sectionFails = {};
const fail = (msg, section) => { failures += 1; if (section) sectionFails[section] = (sectionFails[section] ?? 0) + 1; console.error(`  ✗ FAIL: ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

if (!API_KEY || !PROJECT_ID) {
  console.error('✗ FAIL: need FIREBASE_WEB_API_KEY / NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_PROJECT_ID');
  process.exit(1);
}

// ── 1. SDK surface — the exact call the Google popup makes ─────────────────
// The v3 getProjectConfig idpConfig array is empty on this project even when
// the provider is enabled (only projectId + authorizedDomains come back), so
// it cannot gate Google sign-in. The call that actually decides the popup is
// accounts:createAuthUri with providerId google.com — assert THAT surface.
console.log(`\n[1/2] SDK createAuthUri (${PROJECT_ID})`);
const authUriRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(API_KEY)}`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      identifier: 'probe@example.com',
      providerId: 'google.com',
      continueUri: `https://${PROJECT_ID}.firebaseapp.com`,
    }),
    cache: 'no-store',
  },
).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

if (authUriRes.status !== 200) {
  fail(`createAuthUri → HTTP ${authUriRes.status}`, 'sdk');
} else {
  const uri = authUriRes.body;
  if (uri.providerId === 'google.com') {
    ok('createAuthUri → google.com providerId (the SDK popup resolves it)');
    if (uri.authUri) {
      const clientId = new URL(uri.authUri).searchParams.get('client_id');
      if (clientId && /^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
        ok(`authUri embeds a classic web client id (${clientId.slice(0, 34)}…)`);
      } else if (clientId) {
        fail(`authUri client id is not classic format: ${clientId.slice(0, 40)}`, 'sdk');
      } else {
        fail('authUri has no client_id', 'sdk');
      }
    } else {
      fail('createAuthUri returned providerId but no authUri', 'sdk');
    }
  } else {
    fail(`createAuthUri providerId=${uri.providerId ?? 'none'} — google.com not resolvable`, 'sdk');
  }
}

// ── 2. Admin API cross-check (best-effort when SA configured) ──────────────
if (getServiceAccount()) {
  console.log('\n[2/2] Admin API cross-check');
  try {
    const adminToken = await mintServiceAccountToken();
    const idp = await fetch(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/defaultSupportedIdpConfigs/google.com`,
      { headers: { authorization: `Bearer ${adminToken}` }, cache: 'no-store' },
    );
    if (idp.status === 200) {
      const cfg = await idp.json();
      cfg.enabled === true
        ? ok('admin API: google.com IdP config enabled')
        : fail(`admin API: google.com present but enabled=${cfg.enabled}`, 'admin');
    } else if (idp.status === 404) {
      fail('admin API: google.com IdP config NOT FOUND', 'admin');
    } else {
      fail(`admin API: google.com probe → HTTP ${idp.status}`, 'admin');
    }
  } catch (err) {
    fail(`admin API cross-check errored: ${err.message}`, 'admin');
  }
} else {
  console.log('\n[2/2] Admin API cross-check (skipped — FIREBASE_SERVICE_ACCOUNT not configured)');
}

// Machine-readable sub-check markers for verify:all: each becomes its own
// indented row under the gate in the runner's summary table (same contract as
// the email-envelope sweep in verify-cron-reports.mjs). The admin-config row
// only appears when the SA was configured and the cross-check actually ran.
console.log(`VERIFY-SUBRESULT|sdk-surface|${(sectionFails.sdk ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
if (getServiceAccount()) {
  console.log(`VERIFY-SUBRESULT|admin-config|${(sectionFails.admin ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
}
console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
