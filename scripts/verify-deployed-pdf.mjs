#!/usr/bin/env node
// ============================================================================
// scripts/verify-deployed-pdf.mjs — deployed /api/print/pdf render proof.
//
// Verifies the LIVE PDF route end to end AS THE REAL OWNER — the same session
// mechanism the owner-screenshot capture proved (a service-account-minted
// Firebase custom token for REPORT_OWNER_ID, exchanged for an idToken via
// accounts:signInWithCustomToken). This is the contract that broke on Vercel:
// the route used to 503 "Chrome unavailable" because the serverless runtime
// had no Chrome binary, no traced chromium.br, and no /dev/shm. Asserts:
//
//   1. Unauthenticated POSTs get 401 (the route is auth-gated).
//   2. An authenticated POST with the owner session returns 200,
//      Content-Type: application/pdf, and a body that starts %PDF- — a REAL
//      PDF rendered by the bundled serverless Chromium, not a stub.
//   3. Content-Disposition carries an attachment filename (the download
//      contract the client's <a download> mirrors).
//
// Usage:
//   node scripts/verify-deployed-pdf.mjs [--app https://...] [--api-key <key>] [--owner <uid>]
//
// Reads the web API key from --api-key, then FIREBASE_WEB_API_KEY, then
// NEXT_PUBLIC_FIREBASE_API_KEY, then .env.local; the service account from
// FIREBASE_SERVICE_ACCOUNT / FIREBASE_SERVICE_ACCOUNT_PATH / .env.local (via
// lib/server/sa-token.mjs); and the owner uid from --owner, then
// REPORT_OWNER_ID, then .env.local. Exits nonzero on any failed assertion so
// CI can gate on it. Emits VERIFY-SUBRESULT markers for verify-all.mjs's
// summary table (auth-gate / pdf-render / pdf-filename).
// ============================================================================

import { createSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { getServiceAccount } from '../lib/server/sa-token.mjs';
import { readLocalEnv } from './local-env.mjs';

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────
// Mint a Firebase custom token for `uid` signed by the service account
// (RS256 JWT with the Identity Toolkit audience + uid claim). This is the
// admin-session mechanism the owner screenshot capture proved: the deployed
// routes accept the exchanged idToken as the real owner.
export const mintCustomToken = (saJson, uid) => {
  const sa = JSON.parse(saJson);
  const b64url = (buf) => Buffer.from(buf).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid,
  }));
  const sig = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key, 'base64url');
  return `${header}.${claims}.${sig}`;
};

// Classify the PDF route's HTTP response into the sub-checks the gate asserts:
//   authed  — 200 (the owner session was accepted and the route rendered)
//   pdf     — Content-Type application/pdf AND the body starts %PDF-
//   named   — Content-Disposition carries `attachment; filename="…"`
export const classifyPdfResponse = ({ status, contentType, disposition, head }) => ({
  authed: status === 200,
  pdf: contentType === 'application/pdf' && head === '%PDF-',
  named: typeof disposition === 'string' && disposition.includes('attachment; filename='),
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };

  const BASE = (flag('--app', process.env.VERIFY_BASE_URL) ?? 'https://portfolio-app-freebuff.vercel.app').replace(/\/$/, '');
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
  const OWNER = flag('--owner', process.env.REPORT_OWNER_ID ?? '') || (() => {
    try {
      return readLocalEnv('REPORT_OWNER_ID') ?? '';
    } catch {
      return '';
    }
  })();
  const saJson = getServiceAccount();

  let failures = 0;
  // Per-section failure counts so the end-of-run VERIFY-SUBRESULT markers
  // (which verify-all.mjs renders as indented sub-rows in the summary table)
  // reflect each sub-check independently instead of one global pass/fail.
  // Early-exit failures (missing credentials, mint/exchange failure) exit
  // before the markers, so their gate row alone tells the story.
  const sectionFails = {};
  const fail = (msg, section) => {
    failures += 1;
    if (section) sectionFails[section] = (sectionFails[section] ?? 0) + 1;
    console.error(`  ✗ FAIL: ${msg}`);
  };
  const ok = (msg) => console.log(`  ✓ ${msg}`);

  // 1. Auth gate: unauthenticated POST must be rejected before any session
  //    work happens (also proves the route is owner-scoped, not public).
  console.log(`\n[1/4] Auth gate at ${BASE}/api/print/pdf`);
  const anon = await fetch(`${BASE}/api/print/pdf`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'probe', meta: 'probe', body: '# probe' }),
  });
  if (anon.status !== 401) fail(`expected 401 without auth, got ${anon.status}`, 'auth-gate');
  else ok('unauthenticated request rejected with 401');

  const missing = [];
  if (!API_KEY) missing.push('FIREBASE_WEB_API_KEY');
  if (!saJson) missing.push('FIREBASE_SERVICE_ACCOUNT');
  if (!OWNER) missing.push('REPORT_OWNER_ID');
  if (missing.length > 0) {
    fail(`missing credential(s) for the owner session: ${missing.join(', ')}`, 'pdf-render');
    console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
    process.exit(failures === 0 ? 0 : 1);
  }

  // 2. Mint the owner session: SA-signed custom token → idToken.
  console.log(`\n[2/4] Minting owner session (${OWNER.slice(0, 10)}…) via custom token`);
  const customToken = mintCustomToken(saJson, OWNER);
  const exchange = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  ).then((r) => r.json());
  if (!exchange.idToken) {
    fail(`signInWithCustomToken failed (${JSON.stringify(exchange).slice(0, 200)})`, 'pdf-render');
    console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
    process.exit(failures === 0 ? 0 : 1);
  }
  ok('owner idToken minted');

  // 3. Authenticated POST → a real PDF must come back. The PrintDoc mirrors
  //    what the Reports / Top Three surfaces send (title + meta + body).
  console.log(`\n[3/4] Authenticated POST → expecting a real PDF`);
  const doc = {
    title: 'Deployed PDF gate — live proof',
    meta: 'daily report · 1 attention item',
    body: '# Deployed gate\n\nRendered by the bundled serverless Chromium on Vercel.',
  };
  const res = await fetch(`${BASE}/api/print/pdf`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${exchange.idToken}` },
    body: JSON.stringify(doc),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const verdict = classifyPdfResponse({
    status: res.status,
    contentType: res.headers.get('content-type'),
    disposition: res.headers.get('content-disposition'),
    head: buf.subarray(0, 5).toString(),
  });
  console.log(`  status=${res.status} · content-type=${res.headers.get('content-type')} · bytes=${buf.length}`);
  if (!verdict.authed) {
    fail(`expected 200 with the owner session, got ${res.status}`, 'pdf-render');
  } else {
    ok('authenticated POST accepted (200)');
  }
  if (!verdict.pdf) {
    fail(`expected Content-Type application/pdf + %PDF- body, got ${res.headers.get('content-type')} / ${buf.subarray(0, 12).toString()}`, 'pdf-render');
  } else {
    ok(`real PDF bytes (${buf.length} bytes, %PDF- header)`);
  }
  if (!verdict.named) {
    fail('Content-Disposition has no attachment filename (the download contract)', 'pdf-filename');
  } else {
    ok(`attachment filename present (${res.headers.get('content-disposition')})`);
  }

  // 4. Sub-result markers for the verify:all summary table.
  console.log(`\nVERIFY-SUBRESULT|auth-gate|${(sectionFails['auth-gate'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`VERIFY-SUBRESULT|pdf-render|${(sectionFails['pdf-render'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`VERIFY-SUBRESULT|pdf-filename|${(sectionFails['pdf-filename'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);

  console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}
