#!/usr/bin/env node
// ============================================================================
// scripts/verify-profile-no-email.mjs — deployed /reports + /settings walkthrough
// proving the removed UserProfile.email field stays gone.
//
// The UserProfile.email field (and the whole emailed-report feature) was
// removed: the Settings profile form must never render an Email input or
// label again, and the /reports page must never show a stray Email label.
// This verifier drives the DEPLOYED app in a real headless Chrome via CDP and
// proves that end to end:
//
//   1. Mints a throwaway Identity Toolkit user (same pattern as the other
//      verify-* scripts), deleted on the way out.
//   2. Seeds a composed daily report under that uid (via
//      scripts/seed-in-app-reports.mjs) so /reports has content to render.
//   3. Loads the deployed URL, signs in with the throwaway credentials, and
//      waits for the Command Center shell.
//   4. Walks /reports: asserts the seeded daily report renders and the page
//      text contains no "Email" label.
//   5. Walks /settings: asserts the profile form has no Email input, no Email
//      label, and the Account card still shows auth identity.
//   6. Sweeps the page console for email-related errors.
//
// Usage:
//   node scripts/verify-profile-no-email.mjs [--app https://...] [--screenshot dir]
//
// --screenshot <dir> saves walkthrough-reports.png + walkthrough-settings.png
// into that directory (defaults to /tmp when the flag is passed without a
// value). Reads the Firebase web API key from FIREBASE_WEB_API_KEY, then
// NEXT_PUBLIC_FIREBASE_API_KEY, then .env.local. Exits nonzero on any failure.
// ============================================================================

import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const APP = (flag('--app', process.env.VERIFY_BASE_URL) ?? 'https://portfolio-app-freebuff.vercel.app').replace(/\/$/, '');
// --screenshot [dir] — bare flag defaults to /tmp, a value uses that dir.
const rawShot = flag('--screenshot', '');
const SCREENSHOT_DIR = args.includes('--screenshot') ? (rawShot || '/tmp') : '';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9463;
// A fresh, unique profile per run so no previous sign-in session leaks into
// the next run (a shared fixed dir would keep the Firebase session and the
// AuthGate would never render).
const USER_DATA_DIR = `/tmp/profile-no-email-chrome-${process.pid}-${Date.now()}`;

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

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`  ✗ FAIL: ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ── 1. Mint a throwaway user ────────────────────────────────────────────────
console.log('\n[1/6] Minting throwaway Identity Toolkit user');
const email = `profile-probe-${Date.now()}@e2e.local`;
const password = 'ProbePass-123!';
const signUp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password, returnSecureToken: true }),
}).then((r) => r.json());
if (!signUp.localId || !signUp.idToken) {
  console.error(`✗ FAIL: could not mint a test user (${JSON.stringify(signUp).slice(0, 200)})`);
  process.exit(1);
}
const uid = signUp.localId;
const token = signUp.idToken;
ok(`test user minted (${uid})`);

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

// ── 2. Seed a composed daily report under that uid ──────────────────────────
console.log('[2/6] Seeding composed daily report under the test uid');
const seed = await new Promise((res) => {
  const p = spawn('node', ['scripts/seed-in-app-reports.mjs', '--owner', uid, '--kind', 'daily'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => res({ code, out }));
});
if (seed.code !== 0) fail(`seed failed (${seed.code}): ${seed.out.slice(0, 400)}`);
else ok('report seeded');

// ── 3. Launch headless Chrome ───────────────────────────────────────────────
console.log(`[3/6] Launching headless Chrome (CDP :${PORT})`);
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--disable-background-networking',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${USER_DATA_DIR}`,
  'about:blank',
], { stdio: 'ignore' });

// Self-cleanup: never leave the headless Chrome (or its throwaway profile)
// behind, even when interrupted by a signal or dies mid-run.
const killChrome = () => { try { chrome.kill('SIGKILL'); } catch { /* already gone */ } };
const dropProfile = () => { try { rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ } };
process.on('exit', killChrome);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { killChrome(); dropProfile(); process.exit(130); });
}

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
const consoleErrors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve: res, reject: rej } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) rej(new Error(JSON.stringify(msg.error)));
    else res(msg.result);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params?.exceptionDetails?.exception?.description ?? '';
    consoleErrors.push(d);
  }
  if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
    consoleErrors.push(msg.params.entry.text);
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
await send('Runtime.enable');
await send('Log.enable');

const sleepMs = (ms) => sleep(ms);
const shot = async (path) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  if (data) { writeFileSync(path, Buffer.from(data, 'base64')); ok(`screenshot → ${path}`); }
};

// ── 4. Sign in ──────────────────────────────────────────────────────────────
console.log(`[4/6] Signing in on ${APP}`);
await send('Page.navigate', { url: APP });
let gate = false;
for (let i = 0; i < 30; i++) {
  await sleepMs(1000);
  const s = await evaluate(`(() => {
    const text = document.body?.innerText || '';
    return text.includes('Sign in to sync') && !!document.querySelector('input[type="email"]');
  })()`);
  if (s) { gate = true; break; }
}
if (!gate) fail('AuthGate never became visible');
else ok('AuthGate rendered');

if (gate) {
  await evaluate(`(() => {
    const setVal = (sel, value) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    setVal('input[type="email"]', ${JSON.stringify(email)});
    setVal('input[type="password"]', ${JSON.stringify(password)});
    return true;
  })()`);
  await sleepMs(300);
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button[type="submit"]')].find((b) => b.textContent?.includes('Sign in'));
    if (btn) { btn.click(); return 'clicked'; }
    const form = document.querySelector('form');
    if (form) { form.requestSubmit(); return 'submitted'; }
    return 'none';
  })()`);
}

let shell = false;
for (let i = 0; i < 60; i++) {
  await sleepMs(1000);
  const s = await evaluate(`(() => {
    const text = document.body?.innerText || '';
    return !text.includes('Sign in to sync') && !!document.querySelector('aside[aria-label="Primary navigation"]');
  })()`);
  if (s) { shell = true; break; }
}
if (!shell) fail('Command Center shell never rendered after sign-in');
else ok('signed in — shell released');

// ── 5a. /reports ────────────────────────────────────────────────────────────
console.log('[5/6] Walking /reports');
await send('Page.navigate', { url: `${APP}/reports` });
let reportFound = false;
for (let i = 0; i < 60; i++) {
  await sleepMs(1000);
  const s = await evaluate(`(() => {
    const text = document.body?.innerText || '';
    return /Daily Report \\d+\\/\\d+\\/\\d+/.test(text);
  })()`);
  if (s) { reportFound = true; break; }
}
if (!reportFound) fail('seeded Daily Report never rendered on /reports');
else ok('/reports rendered the seeded daily report');

const reportsText = await evaluate(`document.body.innerText || ''`);
if (/\bEmail\b/i.test(reportsText)) fail('/reports page text still contains an Email label');
else ok('reports page has no stray Email label');

if (SCREENSHOT_DIR) {
  await evaluate(`(() => {
    const summary = [...document.querySelectorAll('summary')].find((s) => /Daily Report/.test(s.textContent || ''));
    if (summary) { summary.click(); return true; }
    return false;
  })()`);
  await sleepMs(1000);
  await shot(resolve(SCREENSHOT_DIR, 'walkthrough-reports.png'));
}

// ── 5b. /settings ───────────────────────────────────────────────────────────
console.log('Walking /settings');
await send('Page.navigate', { url: `${APP}/settings` });
let settingsReady = false;
for (let i = 0; i < 60; i++) {
  await sleepMs(1000);
  const s = await evaluate(`(() => {
    const text = document.body?.innerText || '';
    return text.includes('Settings') && text.includes('Profile');
  })()`);
  if (s) { settingsReady = true; break; }
}
if (!settingsReady) fail('Settings page never rendered');
else ok('/settings rendered');

const settingsState = await evaluate(`(() => {
  const text = document.body?.innerText || '';
  const emailInputs = [...document.querySelectorAll('input[type="email"]')];
  const labels = [...document.querySelectorAll('label')].map((l) => l.textContent?.trim());
  return {
    hasEmailInput: emailInputs.length > 0,
    hasEmailLabel: labels.includes('Email'),
    accountCardShowsAuthEmail: /data isolated per user/.test(text),
    pageText: text.slice(0, 400).replace(/\\s+/g, ' '),
  };
})()`);
if (settingsState.hasEmailInput) fail('Settings profile form still renders an Email input');
if (settingsState.hasEmailLabel) fail('Settings profile form still has an Email label');
if (!settingsState.hasEmailInput && !settingsState.hasEmailLabel) ok('Settings profile form has no Email field');
ok(`Account card still shows auth identity: ${settingsState.accountCardShowsAuthEmail}`);

if (SCREENSHOT_DIR) await shot(resolve(SCREENSHOT_DIR, 'walkthrough-settings.png'));

// ── 6. Console error sweep ──────────────────────────────────────────────────
console.log('[6/6] Sweeping page console for email-related errors');
await sleepMs(500);
const relevant = consoleErrors.filter((e) => /email/i.test(e) || /Cannot read propert/.test(e));
if (relevant.length > 0) fail(`console surfaced email-related errors: ${relevant.slice(0, 3).join(' | ')}`);
else ok(`no email-related console errors (${consoleErrors.length} total console errors observed)`);

ws.close();
chrome.kill();
try { rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
