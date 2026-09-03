#!/usr/bin/env node
// ============================================================================
// scripts/verify-deployments.mjs — deployed deployment-feed smoke test.
//
// Verifies the LIVE /api/deployments endpoint end to end using a throwaway
// Identity Toolkit user (minted with the web API key, deleted afterwards).
// Asserts:
//   1. Unauthenticated calls get 401 (the feed is auth-gated).
//   2. An authenticated call returns 200 with ok:true.
//   3. At least one Firebase Hosting row is present AND HEALTHY — the live
//      proof that the firebasehosting.googleapis.com feed (SA-minted token,
//      correct host) returns a real release whose web.app URL health-checks
//      clean. This is the contract that caught the wrong-host 404 and the
//      name-ignored /v6 filter — a silent regression fails CI here.
//   4. At least one Firebase App Hosting row is present AND HEALTHY — the
//      portfolio app now serves from App Hosting, so the feed must surface
//      its newest SUCCEEDED rollout at the hosted.app URL.
//
// Usage:
//   node scripts/verify-deployments.mjs [--app https://...] [--api-key <key>]
//
// Reads the web API key from --api-key, then FIREBASE_WEB_API_KEY, then
// NEXT_PUBLIC_FIREBASE_API_KEY, then .env.local (the same precedence the
// other deployed gates use). Exits nonzero on any failed assertion so CI can
// gate on it. Emits VERIFY-SUBRESULT markers for verify-all.mjs's summary
// table (auth-gate / firebase-row / apphosting-row).
// ============================================================================

import { readLocalEnv } from './local-env.mjs';
import { fileURLToPath } from 'node:url';

// ── Pure classification (unit-tested): split feed rows into the provider
// buckets the gate asserts on, so the CLI main below stays a thin runner.
// Unknown providers and null rows are ignored; HEALTHY is the only health
// status that counts as healthy (FAILED / DEGRADED / UNKNOWN do not).
export const classifyFeed = (rows) => {
  const all = rows ?? [];
  const firebase = all.filter((r) => r && r.provider === 'firebase');
  const apphosting = all.filter((r) => r && r.provider === 'apphosting');
  return {
    firebase,
    firebaseHealthy: firebase.filter((r) => r.healthStatus === 'HEALTHY'),
    apphosting,
    apphostingHealthy: apphosting.filter((r) => r.healthStatus === 'HEALTHY'),
  };
};

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };

  const BASE = (flag('--app', process.env.VERIFY_BASE_URL) ?? 'https://portfolio-app-freebuff--portfolio-app-freebuff2.us-central1.hosted.app').replace(/\/$/, '');
  const API_KEY =
    flag('--api-key') ??
    process.env.FIREBASE_WEB_API_KEY ??
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
    (() => {
      try {
        return readLocalEnv('NEXT_PUBLIC_FIREBASE_API_KEY') ?? '';
      } catch {
        return '';
      }
    })();

  let failures = 0;
  // Per-section failure counts so the end-of-run VERIFY-SUBRESULT markers
  // (which verify-all.mjs renders as indented sub-rows in the summary table)
  // reflect each sub-check independently instead of one global pass/fail.
  // Early-exit failures (401 gate, missing key, mint failure) exit before the
  // markers, so their gate row alone tells the story.
  const sectionFails = {};
  const fail = (msg, section) => {
    failures += 1;
    if (section) sectionFails[section] = (sectionFails[section] ?? 0) + 1;
    console.error(`  ✗ FAIL: ${msg}`);
  };
  const ok = (msg) => console.log(`  ✓ ${msg}`);

  const getJson = async (path, headers = {}) => {
    const res = await fetch(`${BASE}${path}`, { headers, cache: 'no-store' });
    let json = null;
    try {
      json = await res.json();
    } catch {
      // non-JSON (e.g. HTML error page) → keep null
    }
    return { status: res.status, json };
  };

  // 1. Auth gate.
  console.log(`\n[1/4] Auth gate at ${BASE}`);
  const anon = await getJson('/api/deployments');
  if (anon.status !== 401) fail(`expected 401 without auth, got ${anon.status}`, 'auth-gate');
  else ok('unauthenticated request rejected with 401');

  if (!API_KEY) {
    fail('no web API key available (pass --api-key, set FIREBASE_WEB_API_KEY / NEXT_PUBLIC_FIREBASE_API_KEY, or .env.local)', 'firebase-row');
    console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
    process.exit(failures === 0 ? 0 : 1);
  }

  // 2. Mint the throwaway user (deleted on exit).
  console.log('\n[2/4] Minting throwaway Identity Toolkit user');
  const signUp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `deploy-feed-probe-${Date.now()}@e2e.local`,
      password: 'ProbePass-123!',
      returnSecureToken: true,
    }),
  }).then((r) => r.json());
  if (!signUp.idToken) {
    fail(`could not mint a test user (${JSON.stringify(signUp).slice(0, 200)})`, 'firebase-row');
    console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
    process.exit(failures === 0 ? 0 : 1);
  }
  const token = signUp.idToken;
  console.log(`  ✓ test user minted (${signUp.localId})`);
  const cleanup = async () => {
    try {
      await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
      });
      console.log('  ↳ throwaway user deleted');
    } catch { /* best-effort */ }
  };
  process.on('exit', () => void cleanup());

  // 3. Authenticated feed.
  console.log('\n[3/4] Authenticated /api/deployments');
  const authed = await getJson('/api/deployments', { authorization: `Bearer ${token}` });
  if (authed.status !== 200 || authed.json?.ok !== true) {
    fail(`expected 200 + ok:true with token, got status ${authed.status}`, 'firebase-row');
  } else {
    ok('authenticated request accepted (200 + ok:true)');
  }

  const { firebase, firebaseHealthy, apphosting, apphostingHealthy } = classifyFeed(authed.json?.deployments ?? []);
  if (firebase.length === 0) {
    fail('no firebase provider rows in the feed (the Hosting feed is off or empty)', 'firebase-row');
  } else {
    ok(`firebase rows: ${firebase.length} (${firebaseHealthy.length} HEALTHY)`);
  }
  if (firebaseHealthy.length === 0) {
    fail('no Firebase Hosting row is HEALTHY (the web.app URL must health-check clean)', 'firebase-row');
  } else {
    ok('at least one Firebase Hosting row is HEALTHY');
  }

  if (apphosting.length === 0) {
    fail('no apphosting provider rows in the feed (the App Hosting feed is off or empty)', 'apphosting-row');
  } else {
    ok(`apphosting rows: ${apphosting.length} (${apphostingHealthy.length} HEALTHY)`);
  }
  if (apphostingHealthy.length === 0) {
    fail('no App Hosting row is HEALTHY (the hosted.app URL must health-check clean)', 'apphosting-row');
  } else {
    ok('at least one App Hosting row is HEALTHY');
  }

  // 4. Sub-result markers for the verify:all summary table.
  console.log(`\nVERIFY-SUBRESULT|auth-gate|${(sectionFails['auth-gate'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`VERIFY-SUBRESULT|firebase-row|${(sectionFails['firebase-row'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`VERIFY-SUBRESULT|apphosting-row|${(sectionFails['apphosting-row'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);

  console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}
