#!/usr/bin/env node
// ============================================================================
// scripts/verify-reports-pdf-flow.mjs — Download PDF UI gate for ALL three
// export surfaces.
//
// Proves the FULL UI flows (not just the API): signs into the DEPLOYED app as
// the REAL owner (service-account-minted Firebase custom token for
// REPORT_OWNER_ID exchanged for an idToken — the same session mechanism
// verify-deployed-pdf.mjs uses), then for each printable surface drives the
// actual "Download PDF" button and captures the browser-level download via
// CDP (Browser.setDownloadBehavior) to assert a real %PDF- file lands:
//
//   1. Reports        — /reports, a saved report row's "Download PDF of …"
//   2. Command Center — /, the "Download today's top three as PDF" button on
//                       the Top Three card (renders when topThree has items,
//                       which the owner's seeded data provides)
//   3. Model Comp.    — /model-comparison, the "Download all winner
//                       recommendations as PDF" review-sheet button. That
//                       button only renders once at least one project has a
//                       winner recommendation, so the gate clicks "AI
//                       Recommend" on the first project and waits for the
//                       panel (up to 90s) when no saved winner exists.
//
// Each surface asserts: the button rendered, the click was accepted with no
// error toast, and a real PDF (%PDF- header, > 1000 bytes) landed with the
// slug filename (proving filename parity with the server disposition).
// Emits VERIFY-SUBRESULT markers (reports-pdf-* / cc-pdf-* / mc-pdf-*) for
// verify-all.mjs's summary table.
//
// Usage:
//   node scripts/verify-reports-pdf-flow.mjs [--app https://...]
//
// Reads the web API key from FIREBASE_WEB_API_KEY, then
// NEXT_PUBLIC_FIREBASE_API_KEY, then .env.local; the service account from
// FIREBASE_SERVICE_ACCOUNT / FIREBASE_SERVICE_ACCOUNT_PATH / .env.local (via
// lib/server/sa-token.mjs); and the owner uid from REPORT_OWNER_ID, then
// .env.local. Needs a Chrome binary (CHROME_PATH, else the macOS default; CI
// installs it on the Linux runner).
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
const ok = (msg) => console.log(`  ✓ ${msg}`);
// The section keys are the VERIFY-SUBRESULT names below (reports-pdf-* /
// cc-pdf-* / mc-pdf-*); keep them in sync — a fail() call with a section name
// that no marker emits silently drops the sub-row from the summary table.

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
console.log(`\n[1] Minting owner session (${OWNER.slice(0, 10)}…) via custom token`);
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
console.log(`\n[2] Launching headless Chrome (CDP :${PORT}) with download capture`);
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
  '--no-sandbox', '--disable-dev-shm-usage', '--disable-popup-blocking', '--hide-scrollbars',
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

// ── 3. Inject the owner session ─────────────────────────────────────────────
console.log(`\n[3] Injecting the owner session, then loading ${APP}/reports`);
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

// ── Shared helpers ──────────────────────────────────────────────────────────
// Click a button (by selector/expression), wait for a NEW file to land in the
// downloads dir (beyond the pre-click baseline), and assert it is a real PDF.
const clickDownloadAndVerify = async ({ selectorExpr, baseline, section, label }) => {
  const clicked = await main.evaluate(`(() => {
    const b = ${selectorExpr};
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!clicked) {
    fail(`${label}: button not found`, section);
    return false;
  }
  ok(`${label}: button clicked`);
  let file = null;
  for (let i = 0; i < 60; i++) {
    await sleepMs(1000);
    const files = readdirSync(DOWNLOADS).filter((f) => !f.endsWith('.crdownload'));
    const fresh = files.filter((f) => !baseline.has(f));
    if (fresh.length > 0) { file = fresh[0]; break; }
  }
  if (!file) {
    fail(`${label}: no browser download appeared within 60s of the click`, section);
    return false;
  }
  const filePath = `${DOWNLOADS}/${file}`;
  const buf = readFileSync(filePath);
  const isPdf = buf.subarray(0, 5).toString() === '%PDF-';
  console.log(`  ↳ downloaded: ${file} · ${buf.length} bytes · header ${buf.subarray(0, 8).toString()}`);
  if (!isPdf || buf.length <= 1000) {
    fail(`${label}: expected a real PDF (${isPdf ? '' : 'bad header, '}${buf.length} bytes)`, section);
    return false;
  }
  ok(`${label}: real PDF download (${buf.length} bytes, %PDF- header, filename "${file}")`);
  return true;
};

// Wait for a page shell: the app loaded and the auth gate released (the
// signed-in nav/header is present, no "Sign in to sync").
const waitForShell = async (marker) => {
  let t = '';
  for (let i = 0; i < 45; i++) {
    await sleepMs(1000);
    t = await main.text();
    if (!t.includes('Sign in to sync') && /Command Center|Reports|Model Comparison/.test(t)) return true;
  }
  fail(`app shell never released the auth gate. Page: ${t.slice(0, 300)}`, marker);
  return false;
};

const listDownloaded = () => new Set(readdirSync(DOWNLOADS).filter((f) => !f.endsWith('.crdownload')));

// ── 4. Surface 1: Reports page row ──────────────────────────────────────────
if (await waitForShell('reports-pdf-session')) {
  ok('auth gate released — app rendered as the owner');
} else {
  // waitForShell already recorded the failure; continue so the other surfaces
  // still report their own state (the run will exit nonzero).
}
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

const reportsBaseline = listDownloaded();
const reportsPdf = await clickDownloadAndVerify({
  selectorExpr: `document.querySelector('button[aria-label^="Download PDF of"]')`,
  baseline: reportsBaseline,
  section: 'reports-pdf-click',
  label: 'Reports row Download PDF',
});
if (reportsPdf) ok('Reports row: real PDF landed');
const reportsError = await main.evaluate(`(() => {
  const t = document.body?.innerText || '';
  return /PDF export failed|Failed to.*PDF|Chrome unavailable/.test(t) || /Something went wrong|There was an error/.test(t);
})()`);
if (reportsError) {
  fail('error surfaced after the Reports click', 'reports-pdf-click');
} else {
  ok('no error toast after the Reports click');
}
// The click/download sub-rows: mark the download sub-check from the file
// verdict (the click row covers button-found + no-error).
if (!reportsPdf) fail('Reports download did not complete', 'reports-pdf-download');

// ── 5. Surface 2: Command Center Top Three card ─────────────────────────────
console.log(`\n[5] Driving ${APP}/ — Command Center Top Three card`);
await main.send('Page.navigate', { url: APP });
await sleepMs(4000);
if (await waitForShell('cc-pdf-page')) {
  ok('Command Center shell rendered');
}
// NOTE: the button's aria-label contains an apostrophe ("today's top three"),
// which terminates a single-quoted JS string inside the evaluate expression —
// a naive `document.querySelector('button[aria-label="today's …"]')` is a
// syntax error that silently returns undefined. Use an apostrophe-free prefix
// selector ([aria-label^=…]) instead, exactly like the Reports surface.
let ccButton = false;
for (let i = 0; i < 30; i++) {
  await sleepMs(1000);
  ccButton = await main.evaluate(`(!!document.querySelector('button[aria-label^="Download today"]'))`);
  if (ccButton) break;
}
if (!ccButton) {
  fail(`Top Three Download PDF button never rendered (needs topThree items). Page: ${(await main.text()).slice(0, 400)}`, 'cc-pdf-page');
} else {
  ok('Top Three card rendered with its Download PDF button');
}
const ccBaseline = listDownloaded();
const ccPdf = await clickDownloadAndVerify({
  selectorExpr: `document.querySelector('button[aria-label^="Download today"]')`,
  baseline: ccBaseline,
  section: 'cc-pdf-click',
  label: 'Command Center Top Three Download PDF',
});
if (!ccPdf) fail('Command Center download did not complete', 'cc-pdf-download');
const ccError = await main.evaluate(`(() => {
  const t = document.body?.innerText || '';
  return /PDF export failed|Failed to.*PDF|Chrome unavailable/.test(t) || /Something went wrong|There was an error/.test(t);
})()`);
if (ccError) {
  fail('error surfaced after the Command Center click', 'cc-pdf-click');
} else {
  ok('no error toast after the Command Center click');
}

// ── 6. Surface 3: Model Comparison review sheet ─────────────────────────────
console.log(`\n[6] Driving ${APP}/model-comparison — review sheet`);
await main.send('Page.navigate', { url: `${APP}/model-comparison` });
await sleepMs(4000);
if (await waitForShell('mc-pdf-page')) {
  ok('Model Comparison shell rendered');
}
// The Download-all button only renders once ≥1 project has a winner
// recommendation. If the owner has none saved, click AI Recommend on the
// first project and wait for the panel (OpenRouter round-trip, up to 90s).
let mcButton = await main.evaluate(`(!!document.querySelector('button[aria-label="Download all winner recommendations as PDF"]'))`);
if (!mcButton) {
  console.log('  ↳ no saved winner recommendation — generating one via AI Recommend');
  const clickedRecommend = await main.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('AI Recommend'));
    if (!btn) return 'missing';
    btn.click();
    return 'clicked';
  })()`);
  ok(clickedRecommend === 'clicked' ? 'AI Recommend clicked' : `AI Recommend button missing: ${clickedRecommend}`);
  const panelCount = () => main.evaluate(
    `(document.body.innerText.match(/ai winner recommendation/gi) || []).length`,
  );
  let count = await panelCount();
  for (let i = 0; i < 90 && count < 1; i++) {
    await sleepMs(1000);
    count = await panelCount();
  }
  if (count < 1) {
    fail('AI recommendation panel never rendered within 90s — cannot drive the review-sheet button', 'mc-pdf-page');
  } else {
    ok('AI winner recommendation panel rendered');
  }
  await sleepMs(1500);
  mcButton = await main.evaluate(`(!!document.querySelector('button[aria-label="Download all winner recommendations as PDF"]'))`);
}
if (!mcButton) {
  fail('review-sheet Download PDF button never rendered', 'mc-pdf-page');
} else {
  ok('review-sheet Download PDF button rendered');
}
const mcBaseline = listDownloaded();
const mcPdf = await clickDownloadAndVerify({
  selectorExpr: `document.querySelector('button[aria-label="Download all winner recommendations as PDF"]')`,
  baseline: mcBaseline,
  section: 'mc-pdf-click',
  label: 'Model Comparison review-sheet Download PDF',
});
if (!mcPdf) fail('Model Comparison download did not complete', 'mc-pdf-download');
const mcError = await main.evaluate(`(() => {
  const t = document.body?.innerText || '';
  return /PDF export failed|Failed to.*PDF|Chrome unavailable/.test(t) || /Something went wrong|There was an error/.test(t);
})()`);
if (mcError) {
  fail('error surfaced after the Model Comparison click', 'mc-pdf-click');
} else {
  ok('no error toast after the Model Comparison click');
}

// ── 7. Sub-result markers for the verify:all summary table ──────────────────
console.log(`\nVERIFY-SUBRESULT|reports-pdf-session|${(sectionFails['reports-pdf-session'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|reports-pdf-page|${(sectionFails['reports-pdf-page'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|reports-pdf-click|${(sectionFails['reports-pdf-click'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|reports-pdf-download|${(sectionFails['reports-pdf-download'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|cc-pdf-page|${(sectionFails['cc-pdf-page'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|cc-pdf-click|${(sectionFails['cc-pdf-click'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|cc-pdf-download|${(sectionFails['cc-pdf-download'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|mc-pdf-page|${(sectionFails['mc-pdf-page'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|mc-pdf-click|${(sectionFails['mc-pdf-click'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|mc-pdf-download|${(sectionFails['mc-pdf-download'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);

main.ws.close(); killChrome(); dropProfile();
console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
