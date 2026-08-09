#!/usr/bin/env node
// ============================================================================
// scripts/capture-deployments-feed.mjs — capture the LIVE Deployments feed.
//
// Drives the DEPLOYED app in a real headless Chrome (same CDP pattern as
// verify-review-sheet.mjs / tour-live.mjs) and captures a full-page PNG of
// the /deployments page showing the REAL Vercel + Firebase feed rows, the
// same data the verify:deployments gate proves at the API level — now proven
// at the UI level and captured for the gallery.
//
//  1. Mints a throwaway Identity Toolkit user (deleted on the way out).
//  2. Signs in, navigates to /deployments.
//  3. Waits for the LIVE feed to render (live badge, metric grid, BOTH
//     provider rows, >= MIN_ROWS deployment cards) — the live-flag guard
//     catches the demo-mode regression (NEXT_PUBLIC_LIVE_DEPLOYMENTS off)
//     where the page renders sample rows instead of the real feed.
//  4. Captures the full page (captureBeyondViewport + scroll clip) to
//     ${OUT}/deployments-feed.png and exits nonzero if any assertion fails.
//
// Pure classifier (classifyFeedPage) is exported and unit-tested in
// scripts/capture-deployments-feed.test.ts; the CLI main is guarded so
// importing the module never runs Chrome.
//
// Usage:
//   node scripts/capture-deployments-feed.mjs [--app https://...] [--out /tmp/deployments-feed] [--api-key <key>]
//
// Reads the web API key from --api-key, then FIREBASE_WEB_API_KEY, then
// NEXT_PUBLIC_FIREBASE_API_KEY, then .env.local (the same precedence the
// other deployed drivers use). Emits a RESULT: PASS/FAIL line and exits
// nonzero on any failed assertion so capture-gallery.mjs can NOTE-skip.
// ============================================================================

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { readLocalEnv } from './local-env.mjs';

// Minimum deployment cards the live feed must show. Currently 7 Vercel rows +
// 1 Firebase row; raise/lower here when the monitored repo set changes (the
// classifier unit test locks this constant to the same number).
export const MIN_ROWS = 8;

// ── Pure classifier (unit-tested) ───────────────────────────────────────────
// Turns the /deployments page's innerText into a readiness verdict. Tolerates
// the headless font quirk that drops trailing letters ('Fireba e' instead of
// 'Firebase'), so provider checks use a tolerant prefix. `ready` requires the
// LIVE-feed markers (live badge + metric grid + BOTH providers + enough
// cards), so demo-mode data (live flag off) never satisfies the gate.
export const classifyFeedPage = (text) => {
  const t = text ?? '';
  const rows = (t.match(/Open/g) ?? []).length;
  const live = t.includes('Live health checks') || t.includes('Live from the Vercel API');
  const metrics = t.includes('TOTAL DEPLOYMENTS');
  // Provider ROWS, not bare words: the page description also says "fetched
  // from Vercel", so a provider check must match the card line — provider
  // label + interpunct + environment (e.g. "Firebase · production"). The
  // `[^·]{0,4}` gap tolerates the headless font quirk that drops trailing
  // letters ('Fireba e' instead of 'Firebase') while stopping well short of
  // the NEXT interpunct, so "Fireba" can never satisfy the check via the
  // response-time text ("200 · 251ms") on a different card.
  const firebase = /Fireba[^·]{0,4}·\s*\w+/.test(t);
  const vercel = /Verce[^·]{0,4}·\s*\w+/.test(t);
  return {
    rows,
    live,
    metrics,
    firebase,
    vercel,
    ready: live && metrics && firebase && vercel && rows >= MIN_ROWS,
  };
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };

  const APP = (flag('--app', process.env.VERIFY_BASE_URL) ?? 'https://portfolio-app-freebuff.vercel.app').replace(/\/$/, '');
  const OUT = flag('--out', '/tmp/deployments-feed');
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

  const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const PORT = 9455;
  const USER_DATA_DIR = `/tmp/deployments-feed-chrome-${process.pid}-${Date.now()}`;

  let failures = 0;
  const fail = (msg) => { failures += 1; console.error(`  ✗ FAIL: ${msg}`); };
  const ok = (msg) => console.log(`  ✓ ${msg}`);

  if (!API_KEY) {
    console.error('✗ FAIL: no Firebase web API key (pass --api-key, set FIREBASE_WEB_API_KEY / NEXT_PUBLIC_FIREBASE_API_KEY, or .env.local)');
    process.exit(1);
  }

  // ── 1. Mint a throwaway user ──────────────────────────────────────────────
  console.log('\n[1] Minting throwaway Identity Toolkit user');
  const email = `deploy-feed-shot-${Date.now()}@e2e.local`;
  const password = 'ProbePass-123!';
  const signUp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  }).then((r) => r.json());
  const token = signUp.idToken;
  const uid = signUp.localId;
  if (!token) {
    console.error(`✗ FAIL: could not mint test user (${JSON.stringify(signUp).slice(0, 200)})`);
    process.exit(1);
  }
  ok(`user minted (${uid})`);

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

  // ── 2. Launch Chrome + CDP ────────────────────────────────────────────────
  console.log('\n[2] Launching headless Chrome (CDP :' + PORT + ')');
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
    '--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,1000', '--hide-scrollbars',
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
  if (!wsUrl) { console.error('✗ FAIL: Chrome DevTools did not come up.'); killChrome(); process.exit(1); }

  // Minimal CDP client (the proven plumbing from the other live drivers).
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
      const text = () => evaluate(`document.body?.innerText?.replace(/\\s+/g, ' ').slice(0, 2000) || ''`);
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

  // ── 3. Sign in ────────────────────────────────────────────────────────────
  console.log(`\n[3] Loading ${APP} and signing in`);
  await main.send('Page.navigate', { url: APP });
  let gate = null;
  for (let i = 0; i < 30; i++) {
    await sleepMs(1000);
    gate = await main.evaluate(`(() => {
      const t = document.body?.innerText || '';
      return { gate: t.includes('Sign in to sync'), email: !!document.querySelector('input[type="email"]'), pass: !!document.querySelector('input[type="password"]') };
    })()`);
    if (gate?.gate && gate?.email && gate?.pass) break;
  }
  if (!gate?.gate) {
    const t = await main.text();
    fail(`AuthGate not visible. Page: ${t.slice(0, 200)}`);
    main.ws.close(); chrome.kill();
    console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
    process.exit(failures === 0 ? 0 : 1);
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
    setVal('input[type="email"]', ${JSON.stringify(email)});
    setVal('input[type="password"]', ${JSON.stringify(password)});
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
  let signInRetried = false;
  for (let i = 0; i < 60; i++) {
    await sleepMs(1000);
    shell = await main.evaluate(`(() => {
      const t = document.body?.innerText || '';
      return !t.includes('Sign in to sync') && !!document.querySelector('aside[aria-label="Primary navigation"]');
    })()`);
    if (shell) break;
    // Firebase sign-in can transiently fail with auth/network-request-failed
    // on the first request after idle (observed repeatedly) — retry ONCE
    // mid-poll instead of failing the capture on a network blip.
    if (!signInRetried && i === 20) {
      signInRetried = true;
      console.log('  ↳ sign-in appears stuck — retrying the submit once (transient network)');
      await main.evaluate(`(() => {
        const setVal = (sel, value) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        };
        setVal('input[type="email"]', ${JSON.stringify(email)});
        setVal('input[type="password"]', ${JSON.stringify(password)});
        const btn = [...document.querySelectorAll('button[type="submit"]')].find((b) => b.textContent?.includes('Sign in'));
        if (btn) { btn.click(); return 'clicked'; }
        const form = document.querySelector('form'); if (form) { form.requestSubmit(); return 'submitted'; }
        return 'no-submit';
      })()`);
    }
  }
  if (!shell) {
    const t = await main.text();
    fail(`Command Center shell never rendered after sign-in. Page: ${t.slice(0, 200)}`);
    main.ws.close(); chrome.kill();
    console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
    process.exit(failures === 0 ? 0 : 1);
  }
  ok('signed in — Command Center shell rendered');

  // ── 4. Open /deployments and wait for the LIVE feed ───────────────────────
  console.log('\n[4] Opening /deployments, waiting for the live feed');
  await main.send('Page.navigate', { url: `${APP}/deployments` });
  let verdict = null;
  for (let i = 0; i < 45; i++) {
    await sleepMs(1000);
    verdict = classifyFeedPage(await main.text());
    if (verdict.ready) break;
  }
  const v = verdict ?? classifyFeedPage('');
  ok(`feed rendered (${v.rows} rows)`);
  if (!v.live) fail('live-feed badge missing — the page may be in demo mode (NEXT_PUBLIC_LIVE_DEPLOYMENTS off)');
  if (!v.metrics) fail('metric grid (TOTAL DEPLOYMENTS) missing');
  if (!v.firebase) fail('no Firebase provider row rendered');
  if (!v.vercel) fail('no Vercel provider row rendered');
  if (v.rows < MIN_ROWS) fail(`expected >= ${MIN_ROWS} deployment rows, found ${v.rows}`);
  if (failures > 0) {
    const t = await main.text();
    console.error(`  page text: ${t.slice(0, 400)}`);
  }
  await sleepMs(3500); // let health-check badges settle

  // ── 5. Full-page capture ──────────────────────────────────────────────────
  console.log('\n[5] Capturing full-page screenshot');
  mkdirSync(OUT, { recursive: true });
  const dims = await main.evaluate(`(() => ({
    h: document.documentElement.scrollHeight,
    w: document.documentElement.scrollWidth,
  }))()`);
  const shot = await main.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: dims.w, height: dims.h, scale: 1 },
  });
  const pngPath = `${OUT}/deployments-feed.png`;
  writeFileSync(pngPath, Buffer.from(shot.data, 'base64'));
  ok(`saved ${pngPath}`);

  main.ws.close();
  chrome.kill();
  try { rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
  console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
  await cleanup();
  process.exit(failures === 0 ? 0 : 1);
}
