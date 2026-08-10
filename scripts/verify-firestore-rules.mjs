#!/usr/bin/env node
// ============================================================================
// scripts/verify-firestore-rules.mjs — portfolio-only rules smoke test.
//
// Mints a throwaway Identity Toolkit user and probes Firestore through the
// public REST API with its ID token, asserting the portfolio ruleset behaves
// correctly: the owner can create + read (profiles keyed by uid, and
// userId-scoped collections), and a cross-user write is denied.
//
// Target project (the read-budget guard for verification):
//   - When VERIFY_FIREBASE_PROJECT_ID + VERIFY_FIREBASE_WEB_API_KEY are set
//     (CI + the shared environment), the probe runs against the dedicated
//     VERIFICATION SANDBOX project (portfolio-app-freebuff-verify2) — a second
//     Spark project whose whole purpose is absorbing probe/CI reads, so
//     verification never touches the production Firestore read quota.
//   - Otherwise it falls back to probing the PRODUCTION project
//     (NEXT_PUBLIC_FIREBASE_PROJECT_ID + FIREBASE_WEB_API_KEY) with a notice.
//
// The sandbox result transfers to production ONLY if both projects run the
// SAME rules, so the gate ends with a rules-parity sub-check: it reads both
// projects' DEPLOYED rules via the firebaserules admin API (an admin read —
// it consumes NO Firestore document-read quota) and fails if they differ.
// The sandbox must therefore carry the same firestore.rules file (deploy with
// `npm run deploy:rules`, which pushes the repo file to BOTH projects).
//
// SANDOX-SKIP: provisioning Auth in a brand-new Firebase project is a
// console-only step (the first click can't be scripted). Until that one-time
// click lands, the sandbox signUp probe returns CONFIGURATION_NOT_FOUND. In
// sandbox mode that is a LOUD SKIP, not a hard fail — the sandbox is a
// convenience that absorbs probe reads; its unprovisioned state must not
// block every push. The skip emits a `sandbox-auth` SKIP sub-marker and exits
// 0, and verify-all renders the parent row SKIPPED so it can't be mistaken
// for a green check. A CONFIGURATION_NOT_FOUND against PRODUCTION (fallback
// mode) is a real anomaly and still hard-fails.
//
// Usage:
//   node scripts/verify-firestore-rules.mjs
//
// Reads the target project id / API key from env, then .env.local. The
// parity check needs FIREBASE_SERVICE_ACCOUNT (the production SA is granted
// roles/firebaserules.viewer on the sandbox). Exits nonzero on any failed
// assertion. All probe documents and the throwaway user are deleted on the
// way out.
// ============================================================================

import { getServiceAccount, mintServiceAccountToken } from '../lib/server/sa-token.mjs';
import { readLocalEnv } from './local-env.mjs';

// The dedicated verification sandbox — a second Spark project that absorbs
// probe/CI reads. VERIFY_FIREBASE_PROJECT_ID overrides it (forks may use
// their own sandbox); the default is this repo's.
const VERIFY_PROJECT_DEFAULT = 'portfolio-app-freebuff-verify2';

const envOr = (name) => process.env[name] ?? (() => {
  try {
    return readLocalEnv(name) ?? '';
  } catch {
    return '';
  }
})();

// Sandbox mode: BOTH verify vars set → probe the sandbox (zero production
// reads). Otherwise fall back to the production project (current behavior).
const sandboxProject = envOr('VERIFY_FIREBASE_PROJECT_ID');
const sandboxKey = envOr('VERIFY_FIREBASE_WEB_API_KEY');
const inSandboxMode = Boolean(sandboxProject && sandboxKey);

const projectId = inSandboxMode
  ? sandboxProject
  : envOr('NEXT_PUBLIC_FIREBASE_PROJECT_ID');

const API_KEY = inSandboxMode
  ? sandboxKey
  : (envOr('FIREBASE_WEB_API_KEY') || envOr('NEXT_PUBLIC_FIREBASE_API_KEY'));

if (!projectId || !API_KEY) {
  console.error('✗ FAIL: missing project id or API key');
  process.exit(1);
}

const FS = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

if (inSandboxMode) {
  console.log(`Probing verification sandbox ${projectId} (production read quota untouched)`);
} else {
  console.log(`VERIFY_FIREBASE_* not configured — falling back to probing PRODUCTION ${projectId} (set the sandbox vars to move this gate off the production quota)`);
}

let failures = 0;
// Per-section failure counts so the end-of-run VERIFY-SUBRESULT markers (which
// verify-all.mjs renders as indented sub-rows in the summary table) reflect
// each sub-check independently instead of one global pass/fail.
const sectionFails = {};
const fail = (msg, section) => {
  failures += 1;
  if (section) sectionFails[section] = (sectionFails[section] ?? 0) + 1;
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

// Sandbox Auth not provisioned yet: the sandbox project has no Identity
// Platform config until someone clicks Get started once in the Firebase
// console. That is a LOUD SKIP in sandbox mode (the sandbox is a convenience;
// its absence must not block pushes), surfaced as a SKIPPED parent row + a
// `sandbox-auth` sub-row in verify:all — never a silent green. In production
// fallback mode the same error is a REAL anomaly and still hard-fails below.
if (inSandboxMode && signUp.error?.message === 'CONFIGURATION_NOT_FOUND') {
  console.error('\n✗ SKIP: sandbox Auth not provisioned (CONFIGURATION_NOT_FOUND)');
  console.error(`  The verification sandbox ${projectId} has no Identity Platform/Auth config yet.`);
  console.error(`  One-time console click: https://console.firebase.google.com/project/${projectId}/authentication →`);
  console.error('  Get started → Email/Password → Enable → Save, then re-run this gate.');
  console.error('  Production read quota untouched — no production document reads were made.');
  console.log('VERIFY-SUBRESULT|sandbox-auth|SKIP');
  console.error('\nRESULT: SKIP (sandbox auth not provisioned — probes deferred)');
  process.exit(0);
}

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
res.status === 200 ? ok('create profiles/<uid> (keyed by uid)') : fail(`create profiles/<uid> → ${res.status}`, 'write-read');

res = await fetch(`${FS}/profiles/${uid}`, { headers: AUTH });
res.status === 200 ? ok('read profiles/<uid>') : fail(`read profiles/<uid> → ${res.status}`, 'write-read');

res = await fetch(`${FS}/projects?documentId=${probeA}`, {
  method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' },
  body: JSON.stringify({ fields: { userId: { stringValue: uid } } }),
});
probeDocs.push(`projects/${probeA}`);
res.status === 200 ? ok('create projects/<probe> with userId == auth.uid') : fail(`create projects/<probe> → ${res.status}`, 'write-read');

res = await fetch(`${FS}/projects/${probeA}`, { headers: AUTH });
res.status === 200 ? ok('read projects/<probe>') : fail(`read projects/<probe> → ${res.status}`, 'write-read');

res = await fetch(`${FS}/projects?documentId=${probeB}`, {
  method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' },
  body: JSON.stringify({ fields: { userId: { stringValue: stranger } } }),
});
probeDocs.push(`projects/${probeB}`);
res.status === 403 ? ok('cross-user create projects/<probe> denied (403)') : fail(`cross-user create → ${res.status}`, 'cross-user');

// ── Rules parity: sandbox == production ─────────────────────────────────────
// A probe against the sandbox transfers to production ONLY if the two
// projects run the SAME ruleset. This sub-check reads both projects' DEPLOYED
// rules via the firebaserules admin API and fails if they differ — the
// transfer-of-trust that makes the sandbox probe meaningful. Admin read, not
// a document read: it consumes NO Firestore read quota. Conditional: runs
// when FIREBASE_SERVICE_ACCOUNT resolves (the production SA holds
// roles/firebaserules.viewer on the sandbox); absent → no marker (skipped).
console.log('\n[Parity] sandbox rules must match production');
let parityOk = null;
try {
  if (getServiceAccount()) {
    const saToken = await mintServiceAccountToken();
    const readRules = async (p) => {
      const rel = await (await fetch(`https://firebaserules.googleapis.com/v1/projects/${p}/releases/cloud.firestore`, {
        headers: { authorization: `Bearer ${saToken}` },
      })).json();
      if (!rel.rulesetName) {
        throw new Error(`${p} rules release unreadable (${JSON.stringify(rel).slice(0, 160)})`);
      }
      const rs = await (await fetch(`https://firebaserules.googleapis.com/v1/${rel.rulesetName}`, {
        headers: { authorization: `Bearer ${saToken}` },
      })).json();
      const files = rs.source?.files ?? [];
      return files.map((f) => f.content ?? '').join('\n').trim();
    };
    const prodRules = await readRules(envOr('NEXT_PUBLIC_FIREBASE_PROJECT_ID'));
    const sandboxRules = await readRules(sandboxProject || VERIFY_PROJECT_DEFAULT);
    parityOk = prodRules === sandboxRules;
    parityOk
      ? ok(`sandbox (${sandboxProject || VERIFY_PROJECT_DEFAULT}) rules identical to production`)
      : fail(`sandbox rules differ from production — re-deploy both from the repo file (npm run deploy:rules) so the sandbox probe result transfers`, 'rules-parity');
  } else {
    console.log('  (skipping rules parity — FIREBASE_SERVICE_ACCOUNT not configured)');
  }
} catch (err) {
  fail(`rules parity check failed: ${err.message}`, 'rules-parity');
  parityOk = false;
}

// ── Result ──────────────────────────────────────────────────────────────────
// Machine-readable sub-check markers for verify:all: each becomes its own
// indented row under the gate in the runner's summary table (same contract as
// the email-envelope sweep in verify-cron-reports.mjs). rules-parity is
// conditional — it appears only when the service account resolved.
console.log(`VERIFY-SUBRESULT|portfolio-write-read|${(sectionFails['write-read'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|cross-user-denied|${(sectionFails['cross-user'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
if (parityOk !== null) {
  console.log(`VERIFY-SUBRESULT|rules-parity|${parityOk ? 'PASS' : 'FAIL'}`);
}
console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
