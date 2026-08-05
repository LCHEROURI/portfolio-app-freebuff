#!/usr/bin/env node
// ============================================================================
// scripts/verify-auth-domains.mjs — post-deploy authorized-domains smoke test.
//
// Calls the DEPLOYED app's /api/status with a ?project=<domain> override and
// asserts the Firebase authorized-domains check reports ok:true for the target
// domain — so an unauthorized deployment preview domain blocks shipping before
// any user ever hits the sign-in gate. Uses a throwaway Identity Toolkit user
// for the ID token (same pattern as verify-send-auth.mjs), deleted afterwards.
//
// Usage:
//   node scripts/verify-auth-domains.mjs [--app https://...] [--domain <target>]
//
//   --app    base URL of the deployed app (default: VERIFY_BASE_URL env, else
//            the production URL)
//   --domain the origin/hostname to validate (default: the --app origin).
//            Pass a Vercel preview URL here to validate it before it ships.
//
// Reads the Firebase web API key from FIREBASE_WEB_API_KEY, then
// NEXT_PUBLIC_FIREBASE_API_KEY, then .env.local. Exits nonzero when the
// domain is missing from the project's authorized list.
// ============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const APP = (flag('--app', process.env.VERIFY_BASE_URL) ?? 'https://portfolio-app-freebuff.vercel.app').replace(/\/$/, '');
const DOMAIN = flag('--domain') ?? APP;

const API_KEY =
  process.env.FIREBASE_WEB_API_KEY ??
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
  (() => {
    try {
      const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
      const m = env.match(/^NEXT_PUBLIC_FIREBASE_API_KEY=(.*)$/m);
      return m ? m[1].trim().replace(/^"|"$/g, '') : '';
    } catch {
      return '';
    }
  })();

if (!API_KEY) {
  console.error('✗ FAIL: no Firebase web API key (set FIREBASE_WEB_API_KEY, NEXT_PUBLIC_FIREBASE_API_KEY, or .env.local)');
  process.exit(1);
}

let uid = '';
const cleanup = async () => {
  if (!uid) return;
  try {
    await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: uid }),
    });
    console.log(`  ↳ throwaway user deleted`);
  } catch {
    // best-effort cleanup
  }
};
process.on('exit', () => void cleanup());

// 1. Mint a throwaway user for the ID token (the route is owner-scoped).
console.log(`\n[1/3] Minting throwaway Identity Toolkit user`);
const signUp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `auth-domains-${Date.now()}@e2e.local`, password: 'ProbePass-123!', returnSecureToken: true }),
}).then((r) => r.json());
const token = signUp.idToken;
uid = signUp.localId;
if (!token) {
  console.error(`✗ FAIL: could not mint a test user (${JSON.stringify(signUp).slice(0, 200)})`);
  process.exit(1);
}
console.log(`  ✓ test user minted (${uid})`);

// 2. Call the deployed /api/status with the override.
console.log(`\n[2/3] ${APP}/api/status?project=${DOMAIN}`);
const res = await fetch(`${APP}/api/status?project=${encodeURIComponent(DOMAIN)}`, {
  headers: { authorization: `Bearer ${token}` },
  cache: 'no-store',
});
const body = await res.json().catch(() => null);
const authDomains = body?.integrations?.find((i) => i.id === 'firebase')?.authDomains;

if (!authDomains) {
  console.error(`✗ FAIL: /api/status returned no firebase.authDomains (HTTP ${res.status}). `
    + 'Is the client SDK configured on the deployment, and is the ?project= override deployed?');
  process.exit(1);
}

// 3. Assert the validated domain is authorized.
console.log(`\n[3/3] Domain check for "${authDomains.origin}"`);
if (authDomains.ok === true) {
  console.log(`  ✓ ${authDomains.origin} IS in the project's authorized domains`);
  console.log(`\nRESULT: PASS`);
  process.exit(0);
}

console.error(`  ✗ FAIL: ${authDomains.origin} is NOT in the project's authorized domains`);
console.error(`    Open ${authDomains.href} and add it, then redeploy.`);
console.error(`\nRESULT: FAIL`);
process.exit(1);
