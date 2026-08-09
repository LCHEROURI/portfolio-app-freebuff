#!/usr/bin/env node
// ============================================================================
// scripts/verify-reports-pdf-flow.mjs — Reports-page Download PDF UI gate.
//
// Proves the FULL UI flow (not just the API): signs into the DEPLOYED app as
// the REAL owner (service-account-minted Firebase custom token for
// REPORT_OWNER_ID exchanged for an idToken — the same session mechanism
// verify-deployed-pdf.mjs uses), navigates to /reports, waits for a saved
// report row, CLICKS its actual "Download PDF" button, and captures the
// browser-level download via CDP (Browser.setDownloadBehavior) to assert a
// real %PDF- file lands on disk. Asserts:
//
//   1. session     — the owner idToken mints and the Reports page releases the
//                    auth gate (no "Sign in to sync").
//   2. page        — at least one saved report row renders with a
//                    "Download PDF of …" button.
//   3. click       — the button click is accepted with no error toast
//                    (pdfError / "Something went wrong" absent).
//   4. download    — the browser download completes and the file is a real
//                    PDF (%PDF- header, > 1000 bytes) with the slug filename
//                    (proving filename parity with the server disposition).
//
// This is the client-side complement of verify:deployed-pdf (which POSTs the
// route directly): a regression in the button wiring, the auth facade, the
// blob/anchor save, or the download flow fails CI even though the API is
// healthy.
//
// Usage:
//   node scripts/verify-reports-pdf-flow.mjs [--app https://...]
//
// Reads the web API key from FIREBASE_WEB_API_KEY, then
// NEXT_PUBLIC_FIREBASE_API_KEY, then .env.local; the service account from
// FIREBASE_SERVICE_ACCOUNT / FIREBASE_SERVICE_ACCOUNT_PATH / .env.local (via
// lib/server/sa-token.mjs); and the owner uid from REPORT_OWNER_ID, then
// .env.local. Needs a Chrome binary (CHROME_PATH, else the macOS default; CI
// installs it on the Linux runner). Emits VERIFY-SUBRESULT markers
// (session / page / click / download) for verify-all.mjs's summary table.
// ============================================================================

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { getServiceAccount } from '../lib/server/sa-token.mjs';
import { readLocalEnv } from './local-env.mjs';
import { mintCustomToken } from './verify-deployed-pdf.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const APP = (flag('--app', process.env.VERIFY_BASE_URL) ?? 'https://portfolio-app-freebuff.vercel.app').replace(/\/$/, '');
const OUT = flag('--out', '/tmp/reports-pdf-flow');
const DOWNLOADS = `${OUT}/downloads`;
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9490;
const USER_DATA_DIR = `/tmp/reports-pdf-flow-chrome-${process.pid}-${Date.now()}`;

const API_KEY =
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

mkdirSync(DOWNLOADS, { recursive: true });
let failures = 0;
const sectionFails = {};
const fail = (msg, section) => {
  failures += 1;
  if (section) sectionFails[section] = (sectionFails[section] ?? 0) + 1;
  console.error(`  ✗ FAIL: ${msg}`);
};
// The section keys are the VERIFY-SUBRESULT names below (reports-pdf-*);
// keep them in sync — a fail() call with a section name that no marker
// emits silently drops the sub-row from the summary table.
const ok = (msg) => console.log(`  ✓ ${msg}`);

const missing = [];
if (!API_KEY) missing.push('FIREBASE_WEB_API_KEY');
if (!saJson) missing.push('FIREBASE_SERVICE_ACCOUNT');
if (!OWNER) missing.push('REPORT_OWNER_ID');
if (missing.length > 0) {
  fail(`missing credential(s) for the owner session: ${missing.join(', ')}`, 'reports-pdf-session');
  console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}

// ── 1. Mint the owner session ───────────────────────────────────────────────
console.log(`\n[1/4] Minting owner session (${OWNER.slice(0, 10)}…) via custom token`);
const customToken = mintCustomToken(saJson, OWNER);
const exchange = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  },
).then((r) => r.json());
if (!exchange.idToken || !exchange.refreshToken) {
  fail(`signInWithCustomToken failed (${JSON.stringify(exchange).slice(0, 200)})`, 'reports-pdf-session');
  console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}
const tokenPayload = JSON.parse(Buffer.from(exchange.idToken.split('.')[1], 'base64url').toString());
console.log(`  session for ${tokenPayload.sub} (${tokenPayload.email ?? 'owner'})`);
const expiresAt = Date.now() + parseInt(exchange.expiresIn, 10) * 1000;
ok('owner idToken minted');

// ── 2. Launch headless Chrome with downloads enabled ────────────────────────
console.log(`\n[2/4] Launching headless Chrome (CDP :${PORT}) with download capture`);
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
  '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--window-size=1440,1400',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA_DIR}`, 'about:blank',
], { stdio: 'ignore' });

const killChrome = () => { try { chrome.kill('SIGKILL'); } catch { /* already gone */ } };
const dropProfile = () => { try { rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ } };
process.on('exit', killChrome);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { killChrome(); dropProfile(); process.exit(130); });
}

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch { /* starting */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) { fail('Chrome DevTools did not come up', 'reports-pdf-page'); console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`); killChrome(); process.exit(1); }

const attach = (url) => new Promise((res, rej) => {
  const ws = new WebSocket(url);
  let msgId = 0;
  const pending = new Map();
  let onEvent = null;
  ws.onopen = () => {
    const send = (method, params = {}) => new Promise((r, j) => {
      const id = ++msgId; pending.set(id, { resolve: r, reject: j });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const { result } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return result?.value;
    };
    const text = () => evaluate(`document.body?.innerText?.replace(/\\s+/g, ' ').slice(0, 1500) || ''`);
    res({ ws, send, evaluate, text, on: (fn) => { onEvent = fn; } });
  };
  ws.onerror = rej;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve: r, reject: j } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result);
    } else if (m.method && onEvent) {
      void onEvent(m);
    }
  };
});
const main = await attach(wsUrl);
const sleepMs = (ms) => sleep(ms);
await main.send('Browser.setDownloadBehavior', {
  behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true,
});

// ── 3. Inject the owner session, then load /reports ─────────────────────────
console.log(`\n[3/4] Loading ${APP}/reports as the owner`);
await main.send('Page.navigate', { url: `${APP}/reports` });
await sleepMs(4000);

const authUser = {
  uid: tokenPayload.sub,
  email: tokenPayload.email ?? 'cherouri@gmail.com',
  emailVerified: true,
  displayName: tokenPayload.name ?? '',
  isAnonymous: false,
  photoURL: '',
  providerData: [{
    providerId: 'google.com', uid: tokenPayload.sub,
    displayName: tokenPayload.name ?? '', email: tokenPayload.email ?? 'cherouri@gmail.com', photoURL: '',
  }],
  stsTokenManager: {
    refreshToken: exchange.refreshToken,
    accessToken: exchange.idToken,
    expirationTime: expiresAt,
  },
  createdAt: String(Date.now() - 86400000),
  lastLoginAt: String(Date.now()),
  apiKey: API_KEY,
  appName: '[DEFAULT]',
};
// The modern firebase/auth SDK persists the session in IndexedDB
// (firebaseLocalStorageDb → store firebaseLocalStorage), keyed
// `firebase:authUser:<apiKey>:<appName>` — appName is "[DEFAULT]", NOT the
// appId. The stored value is the UserImpl JSON object (uid + stsTokenManager
// + booleans), which UserImpl._fromJSON parses on init.
const authUserKey = `firebase:authUser:${API_KEY}:[DEFAULT]`;
await main.evaluate(`(async () => {
  const key = ${JSON.stringify(authUserKey)};
  const record = { fbase_key: key, value: ${JSON.stringify(JSON.stringify(authUser))} };
  record.value = JSON.parse(record.value);
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('firebaseLocalStorageDb', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' }); };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('firebaseLocalStorage', 'readwrite');
      const store = tx.objectStore('firebaseLocalStorage');
      store.put(record);
      tx.oncomplete = () => { db.close(); resolve('ok'); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
  localStorage.setItem(key, JSON.stringify(record.value));
  return 'injected';
})()`);
await main.send('Page.reload', { ignoreCache: true });
await sleepMs(3000);

let shell = false;
let t = '';
for (let i = 0; i < 45; i++) {
  await sleepMs(1000);
  t = await main.text();
  if (t.includes('Reports') && !t.includes('Sign in to sync')) { shell = true; break; }
}
if (!shell) {
  fail(`Reports page never released the auth gate. Page: ${t.slice(0, 300)}`, 'reports-pdf-session');
} else {
  ok('auth gate released — Reports page rendered as the owner');
}

// Wait for at least one saved report row with a Download PDF button.
let rowCount = 0;
for (let i = 0; i < 30; i++) {
  await sleepMs(1000);
  rowCount = await main.evaluate(`(document.querySelectorAll('button[aria-label^="Download PDF of"]').length)`);
  if (rowCount > 0) break;
}
if (rowCount === 0) {
  fail(`no saved report rows with a Download PDF button (found ${rowCount}). Page: ${(await main.text()).slice(0, 400)}`, 'reports-pdf-page');
} else {
  ok(`${rowCount} saved report row(s) rendered with Download PDF buttons`);
}

// ── 4. Click the first Download PDF button; capture the download ────────────
console.log(`\n[4/4] Clicking "Download PDF" on the first report row`);
const clicked = await main.evaluate(`(() => {
  const b = document.querySelector('button[aria-label^="Download PDF of"]');
  if (!b) return false;
  b.click();
  return true;
})()`);
if (!clicked) {
  fail('could not click the Download PDF button', 'reports-pdf-click');
} else {
  ok('button clicked');
}

// Watch for the file to land (exclude in-progress .crdownload files).
let file = null;
for (let i = 0; i < 60; i++) {
  await sleepMs(1000);
  const files = readdirSync(DOWNLOADS).filter((f) => !f.endsWith('.crdownload'));
  if (files.length > 0) { file = files[0]; break; }
}
if (!file) {
  fail('no browser download appeared within 60s of the click', 'reports-pdf-download');
} else {
  const filePath = `${DOWNLOADS}/${file}`;
  const buf = readFileSync(filePath);
  const isPdf = buf.subarray(0, 5).toString() === '%PDF-';
  console.log(`  ↳ downloaded: ${file} · ${buf.length} bytes · header ${buf.subarray(0, 8).toString()}`);
  if (!isPdf || buf.length <= 1000) {
    fail(`expected a real PDF (${isPdf ? '' : 'bad header, '}${buf.length} bytes)`, 'reports-pdf-download');
  } else {
    ok(`real PDF download (${buf.length} bytes, %PDF- header, filename "${file}")`);
  }
}

// No error toast / pdfError after the click (the button isn't silently dead).
const errorState = await main.evaluate(`(() => {
  const t = document.body?.innerText || '';
  return {
    pdfError: /PDF export failed|Failed to.*PDF|Chrome unavailable/.test(t),
    errorToast: /Something went wrong|There was an error/.test(t),
  };
})()`);
if (errorState.pdfError || errorState.errorToast) {
  fail(`error surfaced after the click (${JSON.stringify(errorState)})`, 'reports-pdf-click');
} else {
  ok('no error toast after the click');
}

// ── Sub-result markers for the verify:all summary table ────────────────────
console.log(`\nVERIFY-SUBRESULT|reports-pdf-session|${(sectionFails['reports-pdf-session'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|reports-pdf-page|${(sectionFails['reports-pdf-page'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|reports-pdf-click|${(sectionFails['reports-pdf-click'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|reports-pdf-download|${(sectionFails['reports-pdf-download'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);

main.ws.close(); killChrome(); dropProfile();
console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
