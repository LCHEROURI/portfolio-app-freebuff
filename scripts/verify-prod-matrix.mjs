#!/usr/bin/env node
/**
 * Verify the four-corner theme × route matrix against the deployed production
 * URL using Chrome DevTools Protocol with REAL waits (Firebase auth resolution
 * + React hydration never complete under virtual time).
 *
 * Usage: node scripts/verify-prod-matrix.mjs
 */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.PROD_URL ?? 'https://portfolio-app-freebuff.vercel.app';
const PORT = 9333;

const CELLS = [
  ['command-center', 'light'],
  ['command-center', 'dark'],
  ['repositories', 'light'],
  ['repositories', 'dark'],
  ['integrations', 'light'],
  ['integrations', 'dark'],
];

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/prod-matrix-chrome',
  'about:blank',
], { stdio: 'ignore' });

// Self-cleanup: kill the headless Chrome and drop its fixed profile dir even
// when this verifier is interrupted by a signal or dies mid-run.
const killChrome = () => { try { chrome.kill('SIGKILL'); } catch { /* already gone */ } };
const dropProfile = () => { try { rmSync('/tmp/prod-matrix-chrome', { recursive: true, force: true }); } catch { /* best-effort */ } };
process.on('exit', killChrome);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { killChrome(); dropProfile(); process.exit(130); });
}

const sleepMs = (ms) => sleep(ms);
const fetchJson = async (url) => {
  const res = await fetch(url);
  return res.json();
};

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch {
    /* Chrome still starting */
  }
  if (!wsUrl) await sleepMs(250);
}
if (!wsUrl) {
  console.error('Chrome DevTools did not come up.');
  chrome.kill();
  process.exit(1);
}

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let msgId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
};

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
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

for (const [route, theme] of CELLS) {
  const url = `${BASE}/${route}?theme=${theme}`;
  await send('Page.navigate', { url });
  // Real wait: let Firebase auth resolve, store hydrate, and the shell render.
  await sleepMs(14000);

  // innerText excludes <script> content, so these markers are the RENDERED DOM.
  const report = await evaluate(`(() => {
    const html = document.documentElement;
    const aside = document.querySelector('aside[aria-label="Primary navigation"]');
    const widget = document.querySelector('[aria-label="Integration status — Local workspace"]');
    const visible = document.body.innerText || '';
    const headings = Array.from(document.querySelectorAll('h1,h2')).map(h => h.textContent.trim());
    const links = aside
      ? Array.from(aside.querySelectorAll('a')).map(a => a.getAttribute('aria-label') || a.textContent.trim())
      : [];
    const copyBtns = aside
      ? Array.from(aside.querySelectorAll('button[aria-label^="Copy "]')).map(b => b.getAttribute('aria-label'))
      : [];
    return {
      themeClass: html.className,
      hasSidebar: Boolean(aside),
      hasWidget: Boolean(widget),
      renderedTextHead: visible.slice(0, 160).replace(/\\s+/g, ' ').trim(),
      showsLoading: visible.includes('Loading command center'),
      showsAuthGate: visible.includes('Sign in to sync') || visible.includes('Continue with Google'),
      headings: headings.slice(0, 4),
      envSettingsFooter: links.includes('Env settings'),
      perVarLinks: links.filter(l => l.startsWith('Get ')),
      copyButtons: copyBtns.length,
    };
  })()`);

  console.log(JSON.stringify({ route, theme, ...report }));
}

ws.close();
chrome.kill();
