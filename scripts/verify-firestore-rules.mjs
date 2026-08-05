#!/usr/bin/env node
// ============================================================================
// scripts/verify-firestore-rules.mjs — portfolio-only rules smoke test.
//
// Mints a throwaway Identity Toolkit user and probes Firestore through the
// public REST API with its ID token, asserting the portfolio ruleset deployed
// to the dedicated project behaves correctly: the owner can create + read
// (profiles keyed by uid, and userId-scoped collections), and a cross-user
// write is denied.
//
// Usage:
//   node scripts/verify-firestore-rules.mjs
//
// Reads NEXT_PUBLIC_FIREBASE_PROJECT_ID / NEXT_PUBLIC_FIREBASE_API_KEY from
// env, then .env.local. Exits nonzero on any failed assertion. All probe
// documents and the throwaway user are deleted on the way out.
// ============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectId =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  (() => {
    try {
      const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
      return env.match(/^NEXT_PUBLIC_FIREBASE_PROJECT_ID=(.*)$/m)?.[1]?.trim() ?? '';
    } catch {
      return '';
    }
  })();

const API_KEY =
  process.env.FIREBASE_WEB_API_KEY ??
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
  (() => {
    try {
      const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
      return env.match(/^NEXT_PUBLIC_FIREBASE_API_KEY=(.*)$/m)?.[1]?.trim() ?? '';
    } catch {
      return '';
    }
  })();

if (!projectId || !API_KEY) {
  console.error('✗ FAIL: missing NEXT_PUBLIC_FIREBASE_PROJECT_ID or API key');
  process.exit(1);
}

const FS = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  ✗ FAIL: ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

let uid = '';
const probeDocs = [];
const cleanup = async () => {
  for (const p of probeDocs) {
    try {
      await fetch(`${FS}/${p}`, { method: 'DELETE' });
    } catch { /* best-effort */ }
  }
  if (uid) {
    try {
      await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken: uid }),
      });
    } catch { /* best-effort */ }
  }
};
process.on('exit', () => void cleanup());

// ── Mint the throwaway user ─────────────────────────────────────────────────
const signUp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `rules-probe-${Date.now()}@e2e.local`, password: 'ProbePass-123!', returnSecureToken: true }),
}).then((r) => r.json());
uid = signUp.localId;
const token = signUp.idToken;
if (!token) {
  console.error(`✗ FAIL: could not mint a test user (${JSON.stringify(signUp).slice(0, 200)})`);
  process.exit(1);
}
const AUTH = { authorization: `Bearer ${token}` };
const ts = Date.now();
const probeA = `probe-a-${ts}`;
const probeB = `probe-b-${ts}`;
const stranger = `stranger-${ts}`;

console.log(`\nMinted throwaway user ${uid}`);

// ── Portfolio collections ───────────────────────────────────────────────────
console.log('\n[Portfolio] profiles + userId-scoped collections');
let res = await fetch(`${FS}/profiles?documentId=${uid}`, {
  method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' },
  body: JSON.stringify({ fields: { displayName: { stringValue: 'Probe' } } }),
});
probeDocs.push(`profiles/${uid}`);
res.status === 200 ? ok('create profiles/<uid> (keyed by uid)') : fail(`create profiles/<uid> → ${res.status}`);

res = await fetch(`${FS}/profiles/${uid}`, { headers: AUTH });
res.status === 200 ? ok('read profiles/<uid>') : fail(`read profiles/<uid> → ${res.status}`);

res = await fetch(`${FS}/projects?documentId=${probeA}`, {
  method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' },
  body: JSON.stringify({ fields: { userId: { stringValue: uid } } }),
});
probeDocs.push(`projects/${probeA}`);
res.status === 200 ? ok('create projects/<probe> with userId == auth.uid') : fail(`create projects/<probe> → ${res.status}`);

res = await fetch(`${FS}/projects/${probeA}`, { headers: AUTH });
res.status === 200 ? ok('read projects/<probe>') : fail(`read projects/<probe> → ${res.status}`);

res = await fetch(`${FS}/projects?documentId=${probeB}`, {
  method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' },
  body: JSON.stringify({ fields: { userId: { stringValue: stranger } } }),
});
probeDocs.push(`projects/${probeB}`);
res.status === 403 ? ok('cross-user create projects/<probe> denied (403)') : fail(`cross-user create → ${res.status}`);

// ── Result ──────────────────────────────────────────────────────────────────
console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
