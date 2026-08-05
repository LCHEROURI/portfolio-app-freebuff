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

import { getServiceAccount, mintServiceAccountToken } from '../lib/server/sa-token.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DOMAIN = new URL(flag('--domain', 'https://portfolio-app-freebuff.vercel.app')).hostname;
const PROJECT = process.env.FIREBASE_PROJECT_ID ?? 'portfolio-app-freebuff';
const CONFIG_URL = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`;

const saRaw = getServiceAccount();
if (!saRaw) {
  console.error('✗ FAIL: no service account (set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH)');
  process.exit(1);
}
const sa = JSON.parse(saRaw);

// 1. Exchange the JWT for an OAuth access token (shared module — the same
//    credential + mint flow the cron's firestoreAdmin.ts and the seeder use).
let bearer;
try {
  bearer = await mintServiceAccountToken(saRaw);
} catch (err) {
  console.error(`✗ FAIL: token mint → ${err.message}`);
  process.exit(1);
}

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
