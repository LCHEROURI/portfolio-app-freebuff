#!/usr/bin/env node
// ============================================================================
// scripts/verify-send-auth.mjs — Firebase ID-token verification for the send
// route, end to end against the deployed app.
//
// POST /api/reports/send is the user-facing "email this report now" endpoint.
// In demo mode it trusts the `x-app-user` header; in Firebase mode it verifies
// `Authorization: Bearer <idToken>` and uses the token's uid as the owner.
// This script proves the DEPLOYED app is actually in Firebase mode by:
//   1. Minting a throwaway Firebase Auth user via the Identity Toolkit REST
//      API (email/password signup with the public web API key).
//   2. POSTing to ${BASE}/api/reports/send with the real idToken.
//   3. Asserting the response echoes `userId` == the token's uid — NOT the
//      demo `demo-user` / x-app-user identity.
//   4. Deleting the throwaway user (finally block), so no test accounts leak.
//
// Usage:
//   node scripts/verify-send-auth.mjs [--base https://...]
//
// Reads NEXT_PUBLIC_FIREBASE_API_KEY + NEXT_PUBLIC_FIREBASE_PROJECT_ID from
// env, then .env.local. Exits nonzero on any failed assertion.
// ============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = (flag('--base', process.env.VERIFY_BASE_URL) ?? 'https://portfolio-app-freebuff.vercel.app').replace(/\/$/, '');

const readEnv = (key) => {
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^"|"$/g, '') : '';
  } catch {
    return '';
  }
};

const API_KEY = readEnv('NEXT_PUBLIC_FIREBASE_API_KEY');
const PROJECT_ID = readEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID');

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  ✗ FAIL: ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

if (!API_KEY || !PROJECT_ID) {
  console.error('Missing NEXT_PUBLIC_FIREBASE_API_KEY / NEXT_PUBLIC_FIREBASE_PROJECT_ID (set env or .env.local).');
  process.exit(1);
}

// 1. Mint a throwaway Firebase Auth user + ID token via the REST API.
console.log(`\n[1/4] Mint throwaway Firebase user (${PROJECT_ID})`);
const email = `verify-send-${Date.now().toString(36)}@local.test`;
const password = `tmp-${Math.random().toString(36).slice(2, 14)}!Aa1`;
const signUpRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(API_KEY)}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  },
);
const signUp = await signUpRes.json().catch(() => ({}));
const idToken = signUp.idToken;
const uid = signUp.localId;
if (!idToken || !uid) {
  console.error(`signUp failed: ${JSON.stringify(signUp).slice(0, 300)}`);
  process.exit(1);
}
ok(`created throwaway user ${uid} (${email})`);

let deleted = false;
try {
  // 2. Unauthenticated request must be rejected (401).
  console.log('\n[2/4] Auth gate (no token)');
  const anon = await fetch(`${BASE}/api/reports/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'daily', title: 't', body: 'b', attentionCount: 0 }),
    cache: 'no-store',
  });
  if (anon.status !== 401) fail(`expected 401 without auth, got ${anon.status}`);
  else ok('unauthenticated request rejected with 401');

  // 3. The real ID token must be accepted and resolve to the token's uid.
  console.log('\n[3/4] Verified ID token accepted');
  const res = await fetch(`${BASE}/api/reports/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      kind: 'daily',
      title: 'Verify send auth',
      body: '# Daily Command Center Report\n\nID-token verification probe.',
      attentionCount: 0,
    }),
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (res.status !== 200) fail(`expected 200 with valid token, got ${res.status}`);
  if (json.ok !== true) fail(`expected ok:true, got ${JSON.stringify(json).slice(0, 200)}`);
  if (json.userId !== uid) {
    fail(`expected userId=${uid} (token uid), got ${JSON.stringify(json.userId)} — ` +
      'the deployed app is NOT resolving the ID token (demo override active?)');
  } else {
    ok(`userId=${uid} — verified ID token resolved, not the demo x-app-user path`);
  }
  if (typeof json.sent !== 'boolean') fail(`expected boolean sent, got ${JSON.stringify(json.sent)}`);
  else ok(`delivery surfaced gracefully (sent=${json.sent}${json.reason ? `, reason=${json.reason}` : ''})`);

  // 4. The demo x-app-user header must be IGNORED in Firebase mode: the route
  //    should reject it (401) because no Bearer token was presented.
  console.log('\n[4/4] x-app-user spoof is inert in Firebase mode');
  const spoof = await fetch(`${BASE}/api/reports/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-user': 'someone-else' },
    body: JSON.stringify({ kind: 'daily', title: 't', body: 'b', attentionCount: 0 }),
    cache: 'no-store',
  });
  if (spoof.status !== 401) fail(`expected 401 for x-app-user-only spoof, got ${spoof.status}`);
  else ok('x-app-user-only request rejected — owner scoping is token-enforced');
} finally {
  // 5. Always clean up the throwaway user.
  const del = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  ).catch(() => null);
  deleted = del?.ok ?? false;
  console.log(deleted ? `\n✓ deleted throwaway user ${uid}` : `\n⚠ could not delete throwaway user ${uid} (delete returned ${del?.status})`);
}

console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
