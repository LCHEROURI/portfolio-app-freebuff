#!/usr/bin/env node
/**
 * Capture the full README gallery (9 routes × light/dark = 18 PNGs) from a
 * deployed Vercel build using Chrome DevTools Protocol with REAL waits, so the
 * screenshots always match what visitors see at the live link rather than a
 * local dev server.
 *
 * Uses the demo-mode preview deployment (no Firebase vars → no auth gate).
 *
 * Usage:
 *   node scripts/capture-gallery.mjs \
 *     --url https://portfolio-app-freebuff-dvn3k3egz-laredj-chehrouris-projects.vercel.app \
 *     --out screenshots \
 *     --header 'x-vercel-protection-bypass: <secret>'   # repeatable; sent on every request
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9444;
const VIEWPORT_W = 1440;
const VIEWPORT_H = 1000;
// Overridable so quick smoke tests (and CI) don't pay the full settle time.
const WAIT_MS = Number(process.env.CAPTURE_WAIT_MS ?? 12000);

const args = process.argv.slice(2);
// Accept both `--url X` and `--url=X` (and the same for --out).
const valOf = (flag) => {
  const eq = args.find((a) => a.startsWith(`${flag}=`))?.split('=').slice(1).join('=');
  if (eq) return eq;
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
};
const urlArg = valOf('--url')
  ?? 'https://portfolio-app-freebuff.vercel.app';
const outArg = valOf('--out') ?? 'screenshots';

// Repeatable --header 'Name: value' pairs (e.g. Vercel protection bypass).
// Sent on every request via Network.setExtraHTTPHeaders.
const extraHeaders = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  let h;
  if (a.startsWith('--header=')) h = a.slice('--header='.length);
  else if (a === '--header' && args[i + 1]) { h = args[i + 1]; i++; }
  if (h) {
    const idx = h.indexOf(':');
    if (idx === -1) {
      console.error(`Bad --header (want 'Name: value'): ${h}`);
      chrome.kill();
      process.exit(2);
    }
    extraHeaders[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
  }
}

const BASE = urlArg.replace(/\/$/, '');

const ROUTES = [
  'command-center', 'projects', 'versions', 'deployments', 'repositories',
  'model-comparison', 'reports', 'integrations', 'settings',
];

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/gallery-capture-chrome',
  'about:blank',
], { stdio: 'ignore' });

const fetchJson = async (url) => (await fetch(url)).json();

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch { /* starting */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) { console.error('Chrome DevTools did not come up.'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Emulation.setDeviceMetricsOverride', {
  width: VIEWPORT_W, height: VIEWPORT_H, deviceScaleFactor: 1, mobile: false,
});

if (Object.keys(extraHeaders).length) {
  await send('Network.enable');
  await send('Network.setExtraHTTPHeaders', { headers: extraHeaders });
  console.log(`extra HTTP headers: ${Object.keys(extraHeaders).join(', ')}`);
}

await mkdir(outArg, { recursive: true });

const seen = new Set();
const captured = []; // { route, theme, name }
for (const route of ROUTES) {
  for (const theme of ['light', 'dark']) {
    const name = `${route}${theme === 'dark' ? '-dark' : ''}`;
    const url = `${BASE}/${route}?theme=${theme}`;
    await send('Page.navigate', { url });
    await sleep(WAIT_MS); // real wait: hydration + AI fallback settle

    // Sanity: is the app shell (not the auth gate) rendered?
    const state = await send('Runtime.evaluate', {
      expression: `(() => {
        const visible = document.body.innerText || '';
        return {
          gated: visible.includes('Sign in to sync') || visible.includes('Continue with Google'),
          theme: document.documentElement.className,
          hasShell: Boolean(document.querySelector('aside[aria-label="Primary navigation"]')),
          head: visible.slice(0, 80).replace(/\\s+/g, ' ').trim(),
        };
      })()`,
      returnByValue: true,
    });
    const s = state.result.value;
    if (s.gated || !s.hasShell) {
      console.warn(`SKIP ${name}: not the app shell (gated=${s.gated} shell=${s.hasShell}) head="${s.head}"`);
      continue;
    }

    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(`${outArg}/${name}.png`, Buffer.from(shot.data, 'base64'));
    seen.add(name);
    captured.push({ route, theme, name });
    console.log(`captured ${name}.png (theme=${s.theme || 'light'})`);
  }
}

// ── HTML contact sheet ──────────────────────────────────────────────────────
// Emitted next to the PNGs so the gallery is browsable locally without opening
// the README. The shell wrapper relocates it to docs/screenshots.html and
// rewrites the src paths to the repo folder.
const titleOf = (route) =>
  route.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const fig = (cell, label) => cell
  ? `<figure><img src="./${cell.name}.png" alt="${titleOf(cell.route)} ${label}" loading="lazy"><figcaption>${label}</figcaption></figure>`
  : `<figure class="missing"><figcaption>${label} — not captured</figcaption></figure>`;

const cellsHtml = ROUTES.map((route) => {
  const light = captured.find((c) => c.route === route && c.theme === 'light');
  const dark = captured.find((c) => c.route === route && c.theme === 'dark');
  return `
<section>
  <h2>${titleOf(route)}</h2>
  <div class="pair">${fig(light, 'Light')}${fig(dark, 'Dark')}</div>
</section>`;
}).join('\n');

const sheet = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>App Portfolio Command Center — Screenshot Gallery</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 2rem; background: #fffdfa; color: #1f2d2c; }
  @media (prefers-color-scheme: dark) { body { background: #0b1312; color: #fffdfa; } }
  header { max-width: 1200px; margin: 0 auto 2rem; }
  h1 { margin: 0 0 .25rem; }
  header p { margin: 0; opacity: .7; }
  main { max-width: 1200px; margin: 0 auto; display: grid; gap: 2.5rem; }
  section h2 { margin: 0 0 .75rem; font-size: 1.1rem; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  figure { margin: 0; }
  img { width: 100%; height: auto; border: 1px solid rgba(127,127,127,.35); border-radius: 8px; }
  figcaption { margin-top: .35rem; font-size: .8rem; opacity: .7; }
  .missing { border: 1px dashed rgba(127,127,127,.5); border-radius: 8px; padding: 3rem 1rem; text-align: center; }
  @media (max-width: 760px) { .pair { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>App Portfolio Command Center — Screenshot Gallery</h1>
  <p>Captured from ${BASE} · ${seen.size}/18 cells · ${new Date().toISOString().slice(0, 10)}</p>
</header>
<main>${cellsHtml}
</main>
</body>
</html>
`;

await writeFile(`${outArg}/screenshots.html`, sheet);
console.log(`contact sheet written to ${outArg}/screenshots.html`);
console.log(`\n${seen.size}/18 captured into ${outArg}/`);
ws.close();
chrome.kill();
