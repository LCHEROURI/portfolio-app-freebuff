#!/usr/bin/env node
// ============================================================================
// scripts/drive-review-sheet.mjs — drive the LIVE app's Model Comparison
// review sheet (Print all recommendations) end to end.
//
//  1. Mints a throwaway Identity Toolkit user (deleted on the way out).
//  2. Seeds the live-data fixture under that uid via seed-live-data.mjs, so
//     Model Comparison has multiple evaluated projects.
//  3. Drives the deployed app in headless Chrome (same CDP pattern as
//     tour-live.mjs): signs in, navigates to /model-comparison, clicks AI
//     Recommend on two project cards, then clicks 'Print all recommendations'.
//  4. Captures the styled preview window (the review sheet) as a PNG; falls
//     back to the in-page .print-report-all area only if the popup is blocked.
//  5. Deletes the throwaway user AND clears the seeded docs (seed-live-data
//     --clear), so the walkthrough never pollutes the real account.
//
// Usage:
//   node scripts/drive-review-sheet.mjs [--app https://...] [--out /tmp/review-sheet]
// ============================================================================

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const APP = (flag('--app', process.env.VERIFY_BASE_URL) ?? 'https://portfolio-app-freebuff.vercel.app').replace(/\/$/, '');
const OUT = flag('--out', '/tmp/review-sheet');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9350;
const USER_DATA_DIR = `/tmp/review-sheet-chrome-${process.pid}-${Date.now()}`;

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
  console.error('✗ FAIL: no Firebase web API key');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
let failures = 0;
const fail = (msg) => { failures += 1; console.error(`  ✗ FAIL: ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ── 1. Mint a throwaway user ────────────────────────────────────────────────
console.log('\n[1] Minting throwaway Identity Toolkit user');
const signUp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `review-probe-${Date.now()}@e2e.local`, password: 'ProbePass-123!', returnSecureToken: true }),
}).then((r) => r.json());
const token = signUp.idToken;
const uid = signUp.localId;
if (!token) {
  console.error(`✗ FAIL: could not mint test user (${JSON.stringify(signUp).slice(0, 200)})`);
  process.exit(1);
}
ok(`user minted (${uid})`);

const cleanup = async () => {
  // Delete the throwaway auth account (best-effort).
  try {
    await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    });
    console.log('  ↳ throwaway user deleted');
  } catch { /* best-effort */ }
  // Clear the seeded Firestore docs owned by the throwaway uid so the real
  // account and the shared collections never see fixture pollution.
  try {
    const seed = spawn('node', ['scripts/seed-live-data.mjs', '--owner', uid, '--clear'], {
      cwd: resolve(process.cwd()), stdio: 'inherit',
    });
    await new Promise((res) => seed.on('exit', res));
    console.log('  ↳ seeded docs cleared for the throwaway owner');
  } catch { /* best-effort */ }
};
process.on('exit', () => void cleanup());

// ── 2. Seed the live-data fixture under the throwaway uid ───────────────────
console.log('\n[2] Seeding live-data fixture under the throwaway owner');
const seed = spawn('node', ['scripts/seed-live-data.mjs', '--owner', uid], {
  cwd: resolve(process.cwd()), stdio: 'inherit',
});
const seedExit = await new Promise((res) => seed.on('exit', res));
if (seedExit !== 0) {
  console.error('✗ FAIL: seed-live-data.mjs exited nonzero — cannot drive an empty account.');
  process.exit(1);
}
ok('fixture seeded (projects + evaluations under the throwaway owner)');

// ── 3. Launch Chrome + CDP ──────────────────────────────────────────────────
console.log('\n[3] Launching headless Chrome (CDP :' + PORT + ')');
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
  '--no-sandbox', '--disable-dev-shm-usage', '--disable-popup-blocking',
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
if (!wsUrl) { console.error('✗ FAIL: Chrome DevTools did not come up.'); chrome.kill(); process.exit(1); }

// A CDP client with the proven plumbing from tour-live.mjs: send/evaluate
// over one websocket, plus a screenshot and a normalized innerText readout.
const attach = (url) => new Promise((res, rej) => {
  const ws = new WebSocket(url);
  let msgId = 0;
  const pending = new Map();
  ws.onopen = () => {
    const send = (method, params = {}) => new Promise((r, j) => {
      const id = ++msgId; pending.set(id, { resolve: r, reject: j });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const { result } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return result?.value;
    };
    const screenshot = async () => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(data, 'base64');
    };
    const text = () => evaluate(`document.body?.innerText?.replace(/\\s+/g, ' ').slice(0, 1200) || ''`);
    res({ ws, send, evaluate, screenshot, text });
  };
  ws.onerror = rej;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve: r, reject: j } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result);
    }
  };
});

const main = await attach(wsUrl);
const sleepMs = (ms) => sleep(ms);

// ── 4. Sign in ──────────────────────────────────────────────────────────────
console.log(`\n[4] Loading ${APP} and signing in`);
await main.send('Page.navigate', { url: APP });
let gate = null;
for (let i = 0; i < 30; i++) {
  await sleepMs(1000);
  gate = await main.evaluate(`(() => {
    const text = document.body?.innerText || '';
    return { gate: text.includes('Sign in to sync'), email: !!document.querySelector('input[type="email"]') };
  })()`);
  if (gate?.gate && gate?.email) break;
}
if (!gate?.gate) {
  const t = await main.text();
  fail(`AuthGate not visible. Page: ${t.slice(0, 200)}`);
  main.ws.close(); chrome.kill();
  console.error(`\nDRIVE: FAIL (${failures})`);
  process.exit(1);
}
ok('AuthGate rendered');
await main.evaluate(`(() => {
  const setVal = (sel, value) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  setVal('input[type="email"]', ${JSON.stringify(signUp.email)});
  setVal('input[type="password"]', 'ProbePass-123!');
  return true;
})()`);
await sleepMs(300);
await main.evaluate(`(() => {
  const btn = [...document.querySelectorAll('button[type="submit"]')].find((b) => b.textContent?.includes('Sign in'));
  if (btn) { btn.click(); return 'clicked'; }
  const form = document.querySelector('form'); if (form) { form.requestSubmit(); return 'submitted'; }
  return 'no-submit';
})()`);
let shell = false;
for (let i = 0; i < 60; i++) {
  await sleepMs(1000);
  shell = await main.evaluate(`(() => {
    const text = document.body?.innerText || '';
    return !text.includes('Sign in to sync') && [...document.querySelectorAll('h1,h2')].some((h) => h.textContent?.trim() === 'Command Center');
  })()`);
  if (shell) break;
}
if (!shell) {
  const t = await main.text();
  fail(`Command Center shell never rendered after sign-in. Page: ${t.slice(0, 200)}`);
  main.ws.close(); chrome.kill();
  console.error(`\nDRIVE: FAIL (${failures})`);
  process.exit(1);
}
ok('signed in — Command Center shell rendered');

// ── 5. Model Comparison: generate two recommendations ───────────────────────
console.log('\n[5] Opening /model-comparison');
await main.send('Page.navigate', { url: `${APP}/model-comparison` });
await sleepMs(4000);
let recommendButtons = 0;
for (let i = 0; i < 15; i++) {
  recommendButtons = await main.evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => (b.textContent ?? '').includes('AI Recommend'));
    return btns.length;
  })()`);
  if (recommendButtons >= 2) break;
  await sleepMs(1000);
}
if (recommendButtons < 2) {
  const t = await main.text();
  fail(`expected ≥2 AI Recommend buttons, found ${recommendButtons}. Page: ${t.slice(0, 300)}`);
} else {
  ok(`Model Comparison rendered with ${recommendButtons} evaluated projects`);
}

// Click AI Recommend on the first two project cards. The OpenRouter round-trip
// can take 30-60s per project, so poll generously (90s) for the panel heading.
const clickRecommend = async (index) => {
  await main.evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => (b.textContent ?? '').includes('AI Recommend'));
    if (!btns[${index}]) return 'missing';
    btns[${index}].click();
    return 'clicked';
  })()`);
  let panel = false;
  for (let i = 0; i < 90; i++) {
    await sleepMs(1000);
    // The heading is CSS-uppercased (uppercase tracking-wide), so innerText
    // renders it as 'AI WINNER RECOMMENDATION' — compare case-insensitively.
    panel = await main.evaluate(`document.body.innerText.toLowerCase().includes('ai winner recommendation')`);
    if (panel) break;
  }
  return panel;
};

const first = await clickRecommend(0);
ok(first ? 'recommendation #1 generated (panel rendered)' : 'recommendation #1 panel did not render within 90s');
const second = await clickRecommend(1);
ok(second ? 'recommendation #2 generated (panel rendered)' : 'recommendation #2 panel did not render within 90s');

await sleepMs(1500);
const beforeText = await main.text();
console.log(`  ↳ page now shows: ${beforeText.slice(0, 300)}...`);
const pageShot = await main.screenshot();
writeFileSync(`${OUT}/01-model-comparison-panels.png`, pageShot);
ok(`screenshot: ${OUT}/01-model-comparison-panels.png`);

// ── 6. Print all recommendations → capture the preview window ───────────────
console.log('\n[6] Clicking "Print all recommendations"');
// Snapshot the open targets BEFORE the click so the preview popup (an
// about:blank window.open target) can be found by diff afterwards.
const listTargets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
const beforeIds = new Set((await listTargets()).map((t) => t.id));

// userGesture:true gives the click transient user activation, so window.open
// in the print handler is not treated as a popup and the preview opens.
const clicked = await main.send('Runtime.evaluate', {
  expression: `(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Print all recommendations'));
    if (!btn) return 'missing';
    btn.click();
    return 'clicked';
  })()`,
  returnByValue: true,
  userGesture: true,
}).then((r) => r.result?.value);
ok(clicked === 'clicked' ? 'Print all clicked' : `Print all button missing: ${clicked}`);

// The preview opens in a NEW page target. Diff the target list to find it.
let preview = null;
for (let i = 0; i < 10 && !preview; i++) {
  await sleepMs(500);
  const after = await listTargets();
  const popup = after.find((t) => t.type === 'page' && !beforeIds.has(t.id));
  if (popup?.webSocketDebuggerUrl) {
    try { preview = await attach(popup.webSocketDebuggerUrl); } catch { /* retry */ }
  }
}

if (preview) {
  await sleepMs(2000);
  const previewText = await preview.text();
  console.log(`  ↳ preview window: ${previewText.slice(0, 700)}...`);
  const shot = await preview.screenshot();
  writeFileSync(`${OUT}/02-review-sheet-preview.png`, shot);
  ok(`screenshot: ${OUT}/02-review-sheet-preview.png`);
  preview.ws.close();
} else {
  // Popup blocked: the in-page .print-report-all area renders briefly during
  // window.print(). Grab it immediately if still present.
  const fallback = await main.evaluate(`(() => {
    const el = document.querySelector('[data-testid="print-report-all"]');
    return el ? el.innerText.replace(/\\s+/g, ' ').slice(0, 800) : null;
  })()`);
  if (fallback) {
    ok('popup blocked — captured in-page review sheet instead');
    console.log(`  ↳ in-page review sheet: ${fallback.slice(0, 400)}`);
  } else {
    fail('no preview window opened and the in-page fallback was already cleared');
  }
}

main.ws.close();
chrome.kill();
try { rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
console.error(`\nDRIVE: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
