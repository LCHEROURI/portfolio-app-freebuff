#!/usr/bin/env node
// ============================================================================
// scripts/verify-prod-signin.mjs — production sign-in + Firestore sync proof.
//
// Drives the DEPLOYED app in a real headless Chrome via CDP:
//   1. Mints a throwaway Identity Toolkit user (same pattern as the other
//      verify-* scripts), deleted on the way out.
//   2. Loads the deployed URL, waits for the AuthGate, types the throwaway
//      credentials into the email/password form, and submits.
//   3. Asserts the sign-in gate releases: the "Sign in to sync" copy is gone
//      and the Command Center shell (sidebar + Command Center heading) renders.
//   4. Proves Firestore sync under the real account by writing and reading a
//      probe document in the projects collection with the user's ID token
//      through the public REST API (403 would mean the rules block it).
//
// Usage:
//   node scripts/verify-prod-signin.mjs [--app https://...]
//
// Reads the Firebase web API key from FIREBASE_WEB_API_KEY, then
// NEXT_PUBLIC_FIREBASE_API_KEY, then .env.local. Exits nonzero on any failure.
// ============================================================================

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const APP = (flag('--app', process.env.VERIFY_BASE_URL) ?? 'https://portfolio-app-freebuff.vercel.app').replace(/\/$/, '');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;

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

if (!API_KEY) {
  console.error('✗ FAIL: no Firebase web API key (set FIREBASE_WEB_API_KEY, NEXT_PUBLIC_FIREBASE_API_KEY, or .env.local)');
  process.exit(1);
}

const FS = projectId
  ? `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
  : null;

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`  ✗ FAIL: ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ── 1. Mint the throwaway user ───────────────────────────────────────────────
console.log(`\n[1/5] Minting throwaway Identity Toolkit user`);
const signUp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: `signin-probe-${Date.now()}@e2e.local`,
    password: 'ProbePass-123!',
    returnSecureToken: true,
  }),
}).then((r) => r.json());
const uid = signUp.localId;
const token = signUp.idToken;
if (!token) {
  console.error(`✗ FAIL: could not mint a test user (${JSON.stringify(signUp).slice(0, 200)})`);
  process.exit(1);
}
const probeDoc = `probe-signin-${Date.now()}`;
console.log(`  ✓ test user minted (${uid})`);

const cleanup = async () => {
  if (FS && probeDoc) {
    try { await fetch(`${FS}/projects/${probeDoc}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }); } catch { /* best-effort */ }
  }
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

// ── 2. Launch headless Chrome ────────────────────────────────────────────────
console.log(`\n[2/5] Launching headless Chrome (CDP :${PORT})`);
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--disable-background-networking',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/prod-signin-chrome',
  'about:blank',
], { stdio: 'ignore' });

const fetchJson = async (url) => {
  const res = await fetch(url);
  return res.json();
};

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch { /* Chrome still starting */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) {
  console.error('✗ FAIL: Chrome DevTools did not come up.');
  chrome.kill();
  process.exit(1);
}

const ws = new WebSocket(wsUrl);
await new Promise((resolvePromise, reject) => {
  ws.onopen = resolvePromise;
  ws.onerror = reject;
});

let msgId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve: res, reject: rej } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) rej(new Error(JSON.stringify(msg.error)));
    else res(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolvePromise, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve: resolvePromise, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const { result } = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result?.value;
};

const sleepMs = (ms) => sleep(ms);

// ── 3. Load the deployed app and wait for the AuthGate ───────────────────────
console.log(`\n[3/5] Loading ${APP} and waiting for the AuthGate`);
await send('Page.navigate', { url: APP });
let gateVisible = false;
for (let i = 0; i < 30; i++) {
  await sleepMs(1000);
  const state = await evaluate(`(() => {
    const text = document.body?.innerText || '';
    return {
      gate: text.includes('Sign in to sync'),
      email: !!document.querySelector('input[type="email"]'),
      password: !!document.querySelector('input[type="password"]'),
    };
  })()`);
  if (state?.gate && state?.email && state?.password) { gateVisible = true; break; }
  if (state?.gate) { /* still hydrating */ }
}
if (!gateVisible) {
  const text = await evaluate(`document.body?.innerText?.slice(0, 300) || ''`);
  fail(`AuthGate never became visible. Page text: ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
  ws.close(); chrome.kill();
  console.error(`\nRESULT: FAIL (${failures})`);
  process.exit(1);
}
ok('AuthGate rendered (sign-in gate visible)');

// ── 4. Fill the form and submit ──────────────────────────────────────────────
console.log(`\n[4/5] Typing credentials and submitting`);
const typed = await evaluate(`(() => {
  const setVal = (sel, value) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const email = document.querySelector('input[type="email"]');
  const password = document.querySelector('input[type="password"]');
  if (!email || !password) return 'missing-inputs';
  setVal('input[type="email"]', ${JSON.stringify(signUp.email)});
  setVal('input[type="password"]', 'ProbePass-123!');
  return 'typed';
})()`);
if (typed !== 'typed') {
  fail(`could not fill the sign-in form (${typed})`);
  ws.close(); chrome.kill();
  console.error(`\nRESULT: FAIL (${failures})`);
  process.exit(1);
}
await sleepMs(300);
await evaluate(`(() => {
  const form = document.querySelector('form');
  const btn = [...document.querySelectorAll('button[type="submit"]')].find((b) => b.textContent?.includes('Sign in'));
  if (btn) { btn.click(); return 'clicked'; }
  if (form) { form.requestSubmit(); return 'submitted'; }
  return 'no-submit';
})()`);

// ── 5. Assert the gate releases into the Command Center ──────────────────────
console.log(`\n[5/5] Waiting for the Command Center shell (Firestore data)`);
let shell = null;
for (let i = 0; i < 60; i++) {
  await sleepMs(1000);
  const state = await evaluate(`(() => {
    const text = document.body?.innerText || '';
    const aside = document.querySelector('aside[aria-label="Primary navigation"]');
    return {
      gateGone: !text.includes('Sign in to sync'),
      hasSidebar: Boolean(aside),
      commandCenter: Array.from(document.querySelectorAll('h1,h2')).some((h) => h.textContent?.trim() === 'Command Center'),
      loading: text.includes('Loading command center'),
      error: text.includes('Failed to load data'),
      textHead: text.slice(0, 120).replace(/\\s+/g, ' '),
    };
  })()`);
  if (state?.gateGone && state?.hasSidebar && state?.commandCenter && !state?.loading) { shell = state; break; }
}
if (!shell) {
  const state = await evaluate(`({ text: (document.body?.innerText || '').slice(0, 300) })`);
  fail(`Command Center never rendered after sign-in. Page: ${state?.text?.replace(/\s+/g, ' ').slice(0, 220)}`);
  ws.close(); chrome.kill();
  console.error(`\nRESULT: FAIL (${failures})`);
  process.exit(1);
}
ok('sign-in gate released — Command Center shell rendered');
if (shell.error) fail('store surfaced "Failed to load data"');

// ── 5b. Firestore sync proof under the real account ──────────────────────────
if (FS) {
  console.log('\n[5b] Proving Firestore read/write sync under the signed-in account');
  const AUTH = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const res = await fetch(`${FS}/projects?documentId=${probeDoc}`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ fields: { userId: { stringValue: uid }, name: { stringValue: 'Sign-in probe' } } }),
  });
  if (res.status === 200) {
    ok(`wrote projects/${probeDoc} as the signed-in user`);
    const read = await fetch(`${FS}/projects/${probeDoc}`, { headers: AUTH });
    read.status === 200 ? ok('read it back (rules allow owner read)') : fail(`read back → ${read.status}`);
  } else {
    fail(`create probe doc → ${res.status} (rules may block the account's own writes)`);
  }
} else {
  console.log('  (skipping Firestore probe — NEXT_PUBLIC_FIREBASE_PROJECT_ID not set)');
}

ws.close();
chrome.kill();
console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
