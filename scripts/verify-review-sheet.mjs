#!/usr/bin/env node
// ============================================================================
// scripts/verify-review-sheet.mjs — review-sheet (Print all) gate for the
// LIVE app's Model Comparison page.
//
// Drives the DEPLOYED app in a real headless Chrome (same CDP pattern as
// tour-live.mjs) and proves the print-all contract end to end:
//
//  1. Mints a throwaway Identity Toolkit user (deleted on the way out).
//  2. Seeds the live-data fixture under that uid via seed-live-data.mjs, so
//     Model Comparison has multiple evaluated projects.
//  3. Signs in, navigates to /model-comparison, clicks AI Recommend on two
//     project cards, then clicks 'Print all recommendations'.
//  4. Captures the styled preview window (the review sheet) and ASSERTS it
//     renders the review-sheet title, BOTH numbered recommendations, and the
//     friendly model label (DeepSeek Chat) — the print-all contract. Falls
//     back to the in-page .print-report-all area only if the popup is blocked.
//  5. Deletes the throwaway user AND clears the seeded docs (seed-live-data
//     --clear), so the walkthrough never pollutes the real account.
//
// Emits VERIFY-SUBRESULT|<name>|<PASS|FAIL> markers (review-sheet-preview /
// review-sheet-entries / review-sheet-model-label) so verify:all renders the
// sub-checks as rows under the gate. Exits nonzero when any assertion fails.
//
// Usage:
//   node scripts/verify-review-sheet.mjs [--app https://...] [--out /tmp/review-sheet]
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

// Run-once flag: the success path AWAITS cleanup before exiting, and the exit
// handler stays as a crash backstop — without the flag the two would run the
// (idempotent but slow) --clear twice. The exit handler itself cannot await
// async work, so only the explicit success-path await guarantees the throwaway
// user and seeded docs are really gone before the process exits.
let cleaned = false;
const cleanup = async () => {
  if (cleaned) return;
  cleaned = true;
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

// Click AI Recommend on project cards one at a time. IMPORTANT: once a card
// starts thinking, its button text becomes 'Thinking…', so an index-based
// button list shifts and btns[1] can vanish — always click the FIRST remaining
// 'AI Recommend' button. The OpenRouter round-trip can take 30-60s per project,
// so poll generously (90s) for the panel COUNT to increment (the heading is
// CSS-uppercased to 'AI WINNER RECOMMENDATION', so count case-insensitively;
// a global text check would let the first panel satisfy every later click).
const panelCount = () => main.evaluate(
  `(document.body.innerText.match(/ai winner recommendation/gi) || []).length`,
);
const clickNextRecommend = async (expectedPanels) => {
  const clicked = await main.evaluate(`(() => {
    // Click the AI Recommend button whose CARD has no recommendation panel yet.
    // Once a card completes, its button text returns to 'AI Recommend', so a
    // plain first-match would re-trigger the already-done project. Each project
    // card is a div.card-base, so locate the button via closest('.card-base')
    // and skip cards already showing the panel heading.
    const btn = [...document.querySelectorAll('button')].find((b) => {
      if (!(b.textContent ?? '').includes('AI Recommend')) return false;
      const card = b.closest('.card-base');
      return !((card?.innerText ?? '').toLowerCase().includes('ai winner recommendation'));
    });
    if (!btn) return 'missing';
    btn.click();
    return 'clicked';
  })()`);
  if (clicked !== 'clicked') return clicked;
  let count = await panelCount();
  for (let i = 0; i < 90 && count < expectedPanels; i++) {
    await sleepMs(1000);
    count = await panelCount();
  }
  return count >= expectedPanels ? 'panels' : `stuck-at-${count}`;
};

const first = await clickNextRecommend(1);
ok(first === 'panels' ? 'recommendation #1 generated (panel rendered)' : `recommendation #1 panel did not render within 90s (${first})`);
const second = await clickNextRecommend(2);
ok(second === 'panels' ? 'recommendation #2 generated (panel rendered)' : `recommendation #2 panel did not render within 90s (${second})`);

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

// Capture the review sheet text: the preview window when it opened, else the
// in-page .print-report-all fallback (both render the SAME shared-builder
// document — the assertions below accept either surface, but need at least
// one).
let reviewSheetText = null;
if (preview) {
  await sleepMs(2000);
  const previewText = await preview.text();
  console.log(`  ↳ preview window: ${previewText.slice(0, 700)}...`);
  const shot = await preview.screenshot();
  writeFileSync(`${OUT}/02-review-sheet-preview.png`, shot);
  ok(`screenshot: ${OUT}/02-review-sheet-preview.png`);
  preview.ws.close();
  reviewSheetText = previewText;
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
    reviewSheetText = fallback;
  } else {
    fail('no preview window opened and the in-page fallback was already cleared');
  }
}

// ── 6b. Assert the print-all contract on the captured review sheet ──────────
// The gate's core proof: the review sheet must render BOTH numbered
// recommendations with the friendly model label. The preview window and the
// in-page fallback render the SAME document (shared builder), so either
// surface satisfies the assertions — but at least one must be captured.
const sectionFails = {};
const subFail = (section, msg) => {
  sectionFails[section] = (sectionFails[section] ?? 0) + 1;
  fail(msg);
};

if (!reviewSheetText) {
  subFail('review-sheet-preview', 'no review sheet captured (popup blocked AND in-page fallback already cleared)');
} else {
  const title = /AI winner recommendations — all projects/.test(reviewSheetText);
  title
    ? ok('review sheet title renders in the preview')
    : subFail('review-sheet-preview', 'review sheet title missing from the captured document');
  // Both numbered entries: the meta line carries the count and the list is
  // numbered 1. … 2. — the print-all contract the user drives in the UI.
  const meta = /2 AI winner recommendations across all projects/.test(reviewSheetText);
  meta
    ? ok('meta line proves BOTH recommendations are listed (2 across all projects)')
    : subFail('review-sheet-entries', 'meta line missing or count is not 2 — expected both recommendations');
  const numbered = /1\. /.test(reviewSheetText) && /2\. /.test(reviewSheetText);
  numbered
    ? ok('numbered entries 1. and 2. render')
    : subFail('review-sheet-entries', 'numbered entries 1./2. missing from the review sheet');
  const label = /DeepSeek Chat/.test(reviewSheetText);
  label
    ? ok('friendly model label (DeepSeek Chat) renders')
    : subFail('review-sheet-model-label', 'friendly model label missing from the review sheet');
}

// Machine-readable sub-check markers for verify:all (same contract as the
// other capture gates). Emitted ALWAYS so the summary shows the sub-rows even
// when an early failure short-circuited the content assertions.
console.log(`VERIFY-SUBRESULT|review-sheet-preview|${(sectionFails['review-sheet-preview'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|review-sheet-entries|${(sectionFails['review-sheet-entries'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|review-sheet-model-label|${(sectionFails['review-sheet-model-label'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);

main.ws.close();
chrome.kill();
try { rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
console.error(`\nDRIVE: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
// Await the async cleanup explicitly — the exit handler fires `void cleanup()`
// which Node never awaits, so without this the throwaway account and seeded
// docs could silently survive the run.
await cleanup();
process.exit(failures === 0 ? 0 : 1);
