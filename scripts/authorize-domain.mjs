#!/usr/bin/env node
// ============================================================================
// scripts/authorize-domain.mjs — add a deployment URL to the project's
// authorized domains using a service account (for CI), so a fresh Vercel
// deployment URL never blocks the preview gate by default.
//
//   node scripts/authorize-domain.mjs --domain https://...-vercel.app
//
// Reads the service account JSON from FIREBASE_SERVICE_ACCOUNT (a JSON
// string) or FIREBASE_SERVICE_ACCOUNT_PATH (a file). Mints a Google OAuth
// token from the SA private key (JWT RS256 -> token endpoint), reads the
// Identity Platform admin config, appends the domain if missing, and PATCHes
// it back. Idempotent: exits 0 when already present. Exits nonzero on API
// failure so CI can fail when the automated add fails.
// ============================================================================

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DOMAIN = new URL(flag('--domain', 'https://portfolio-app-freebuff.vercel.app')).hostname;
const PROJECT = process.env.FIREBASE_PROJECT_ID ?? 'meal-planner-lcherouri';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CONFIG_URL = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`;

const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT
  ?? (process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8')
    : '');
if (!saRaw) {
  console.error('✗ FAIL: no service account (set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH)');
  process.exit(1);
}
const sa = JSON.parse(saRaw);

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

// 1. Exchange the JWT for an OAuth access token.
console.log(`[1/3] Minting OAuth token for ${sa.client_email}`);
const tokRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }),
});
const tokJson = await tokRes.json().catch(() => ({}));
if (!tokRes.ok || !tokJson.access_token) {
  console.error(`✗ FAIL: token mint → ${tokRes.status} ${JSON.stringify(tokJson).slice(0, 200)}`);
  process.exit(1);
}
const bearer = tokJson.access_token;

// 2. Read the current authorizedDomains.
console.log(`[2/3] Reading admin config for ${PROJECT}`);
const H = { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' };
const getRes = await fetch(CONFIG_URL, { headers: H });
const getJson = await getRes.json().catch(() => ({}));
if (!getRes.ok) {
  console.error(`✗ FAIL: GET config → ${getRes.status} ${JSON.stringify(getJson).slice(0, 200)}`);
  process.exit(1);
}
const current = getJson.authorizedDomains ?? [];

if (current.includes(DOMAIN)) {
  console.log(`  ✓ ${DOMAIN} already authorized — nothing to do`);
  console.log('\nRESULT: PASS');
  process.exit(0);
}

// 3. Append and PATCH.
console.log(`[3/3] Adding ${DOMAIN}`);
const patchRes = await fetch(`${CONFIG_URL}?updateMask=authorizedDomains`, {
  method: 'PATCH',
  headers: H,
  body: JSON.stringify({ authorizedDomains: [...current, DOMAIN] }),
});
const patchJson = await patchRes.json().catch(() => ({}));
if (!patchRes.ok) {
  console.error(`✗ FAIL: PATCH config → ${patchRes.status} ${JSON.stringify(patchJson).slice(0, 200)}`);
  process.exit(1);
}
const after = patchJson.authorizedDomains ?? [];
console.log(`  ✓ added — now ${after.length} domains (${after.includes(DOMAIN) ? 'present' : 'MISSING'})`);
console.log('\nRESULT: PASS');
process.exit(0);
