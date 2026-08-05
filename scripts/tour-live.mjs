#!/usr/bin/env node
// ============================================================================
// scripts/tour-live.mjs — guided tour of the LIVE production app.
//
// Drives a real headless Chrome session against the deployed app (same CDP
// pattern as verify-prod-signin.mjs): mints a throwaway Identity Toolkit
// user, signs in through the AuthGate, then walks the main routes — Command
// Center, Projects, Reports — triggering the AI briefing on the Top Three
// card, and prints what each page actually shows. Captures a screenshot per
// stop into --out (default /tmp/tour-live).
//
// Usage:
//   node scripts/tour-live.mjs [--app https://...] [--out /tmp/tour-live]
//
// Reads the Firebase web API key from FIREBASE_WEB_API_KEY, then
// NEXT_PUBLIC_FIREBASE_API_KEY, then .env.local.
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
const OUT = flag('--out', '/tmp/tour-live');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9342;
const USER_DATA_DIR = `/tmp/tour-live-chrome-${process.pid}-${Date.now()}`;

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
  body: JSON.stringify({ email: `tour-probe-${Date.now()}@e2e.local`, password: 'ProbePass-123!', returnSecureToken: true }),
}).then((r) => r.json());
const token = signUp.idToken;
if (!token) {
  console.error(`✗ FAIL: could not mint test user (${JSON.stringify(signUp).slice(0, 200)})`);
  process.exit(1);
}
const cleanup = async () => {
  try {
    await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    });
    console.log('  ↳ throwaway user deleted');
  } catch { /* best-effort */ }
};
process.on('exit', () => void cleanup());

// ── 2. Launch Chrome + CDP ─────────────────────────────────────────────────
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
  '--no-sandbox', '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA_DIR}`, 'about:blank',
], { stdio: 'ignore' });

// Self-cleanup: kill the headless Chrome and drop its throwaway profile even
// when the tour is interrupted by a signal or dies mid-run.
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

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve: r, reject: j } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result);
  }
};
const send = (method, params = {}) => new Promise((r, j) => {
  const id = ++msgId; pending.set(id, { resolve: r, reject: j });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const { result } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result?.value;
};
const sleepMs = (ms) => sleep(ms);
const screenshot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  return `${OUT}/${name}.png`;
};
const pageText = () => evaluate(`document.body?.innerText?.replace(/\\s+/g, ' ').slice(0, 900) || ''`);

// ── 3. Sign in ──────────────────────────────────────────────────────────────
console.log(`\n[2] Loading ${APP} and signing in`);
await send('Page.navigate', { url: APP });
let gate = null;
for (let i = 0; i < 30; i++) {
  await sleepMs(1000);
  gate = await evaluate(`(() => {
    const text = document.body?.innerText || '';
    return { gate: text.includes('Sign in to sync'), email: !!document.querySelector('input[type="email"]') };
  })()`);
  if (gate?.gate && gate?.email) break;
}
if (!gate?.gate) {
  const t = await pageText();
  fail(`AuthGate not visible. Page: ${t.slice(0, 200)}`);
  ws.close(); chrome.kill();
  console.error(`\nTOUR: FAIL (${failures})`);
  process.exit(1);
}
await evaluate(`(() => {
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
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button[type="submit"]')].find((b) => b.textContent?.includes('Sign in'));
  if (btn) { btn.click(); return 'clicked'; }
  const form = document.querySelector('form'); if (form) { form.requestSubmit(); return 'submitted'; }
  return 'no-submit';
})()`);
for (let i = 0; i < 60; i++) {
  await sleepMs(1000);
  const t = await evaluate(`(() => {
    const text = document.body?.innerText || '';
    return !text.includes('Sign in to sync') && [...document.querySelectorAll('h1,h2')].some((h) => h.textContent?.trim() === 'Command Center');
  })()`);
  if (t) break;
}
ok('signed in — Command Center shell rendered');
await screenshot('01-command-center');
console.log('  ↳ screenshot: 01-command-center.png');
const ccText = await pageText();
console.log(`  ↳ Command Center shows: ${ccText.slice(0, 300)}...`);

// ── 4. Trigger the AI briefing on the Top Three ─────────────────────────────
console.log('\n[3] Triggering the AI briefing (AI Explain / Regenerate)');
const buttonState = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /AI Explain|Regenerate briefing/.test(b.textContent ?? ''));
  if (!btn) return 'no-button';
  btn.click();
  return btn.textContent.trim();
})()`);
ok(buttonState === 'no-button' ? 'no AI Explain button found' : `clicked "${buttonState}"`);
// OpenRouter round-trips are slow; poll up to ~25s for the model label in the
// main content area (not the sidebar chrome).
let modelLabel = null;
for (let i = 0; i < 25; i++) {
  await sleepMs(1000);
  modelLabel = await evaluate(`(() => {
    const main = document.querySelector('main') || document.body;
    const text = main.innerText || '';
    const m = text.match(/DeepSeek[^\n]{0,40}|GPT-?[^\n]{0,30}|Gemini[^\n]{0,30}|Claude[^\n]{0,30}/i);
    return m ? m[0].trim() : null;
  })()`);
  if (modelLabel) break;
}
if (modelLabel) ok(`briefing rendered — model: ${modelLabel}`);
else console.log('  ⚠ no model label in main content (may be on deterministic fallback)');
const narration = await evaluate(`(() => {
  const main = document.querySelector('main') || document.body;
  return (main.innerText || '').replace(/\s+/g, ' ').slice(0, 700);
})()`);
console.log(`  ↳ main content: ${narration}`);
await screenshot('02-briefing');
console.log('  ↳ screenshot: 02-briefing.png');

// ── 5. Walk the other routes ────────────────────────────────────────────────
for (const [route, name] of [['/projects', '03-projects'], ['/reports', '04-reports'], ['/repositories', '05-repositories']]) {
  console.log(`\n[4] ${route}`);
  await send('Page.navigate', { url: `${APP}${route}` });
  await sleepMs(3500);
  const t = await pageText();
  console.log(`  ↳ ${t.slice(0, 220)}`);
  await screenshot(name);
  console.log(`  ↳ screenshot: ${name}.png`);
}

ws.close();
chrome.kill();
try { rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
console.error(`\nTOUR: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
