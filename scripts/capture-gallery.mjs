#!/usr/bin/env node
/**
 * Capture the full README gallery (9 routes × light/dark = 18 PNGs) from a
 * deployed Vercel build using Chrome DevTools Protocol with REAL waits, so the
 * screenshots always match what visitors see at the live link rather than a
 * local dev server. When the Firebase env is present, also re-renders the two
 * Model Comparison review-sheet cells (review-sheet-panels / preview) via the
 * shared verify-review-sheet.mjs driver, and the live /deployments feed cell
 * (deployments-feed.png) via the shared capture-deployments-feed.mjs driver,
 * so the print-all pair and the feed capture ship with the gallery on every
 * deploy.
 *
 * Uses the demo-mode preview deployment (no Firebase vars → no auth gate) for
 * the route cells; the review-sheet and deployments-feed cells need the LIVE
 * app (auth) and default to the production URL (override with
 * --review-sheet-app / --deployments-feed-app).
 *
 * Usage:
 *   node scripts/capture-gallery.mjs \
 *     --url https://portfolio-app-freebuff-dvn3k3egz-laredj-chehrouris-projects.vercel.app \
 *     --out screenshots \
 *     --header 'x-vercel-protection-bypass: <secret>'   # repeatable; sent on every request
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// Single source of truth shared with app/gallery/page.tsx and
// app/screenshots/[file]/route.ts so the pages, the allowlist, and the
// captured cells can never drift apart.
import galleryCells from '../lib/gallery-cells.json' with { type: 'json' };

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
// The review-sheet cells need the LIVE app (Firebase auth + server AI), which
// the demo-mode preview this driver targets does not have — so they default to
// the production URL, independent of --url.
const reviewSheetAppArg = valOf('--review-sheet-app')
  ?? 'https://portfolio-app-freebuff.vercel.app';
// The deployments-feed cell also needs the LIVE app (Firebase auth): the
// demo-mode preview this driver targets cannot sign in. Defaults to
// production, independent of --url, same as the review-sheet cells.
const deploymentsFeedAppArg = valOf('--deployments-feed-app')
  ?? 'https://portfolio-app-freebuff.vercel.app';

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
      process.exit(2);
    }
    extraHeaders[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
  }
}

const BASE = urlArg.replace(/\/$/, '');

const ROUTES = galleryCells.map((c) => c.route);

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/gallery-capture-chrome',
  'about:blank',
], { stdio: 'ignore' });

// Self-cleanup: never leave the headless Chrome behind, even when this driver
// is interrupted by a signal or dies mid-run (a leaked instance holds port
// 9444 and its /tmp profile until the next reboot).
const killChrome = () => { try { chrome.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('exit', killChrome);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => process.exit(130));
}

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

// ── Review-sheet cells (Model Comparison print-all) ─────────────────────────
// The review-sheet pair cannot be captured from the route loop: it needs a
// signed-in owner with seeded evaluations plus TWO live AI round-trips, which
// the demo-mode preview (no Firebase) cannot produce. So these two cells reuse
// the SHARED review-sheet driver (scripts/verify-review-sheet.mjs) — the same
// driver the verify:review-sheet gate runs — and copy its two outputs into
// the gallery under stable names, so the committed PNGs always match what the
// print-all flow actually renders. Runs only when the Firebase env the driver
// needs is present (FIREBASE_WEB_API_KEY + FIREBASE_SERVICE_ACCOUNT); skips
// with a NOTE (not a SKIP, so the shell wrapper's stale-gallery guard stays
// quiet) when absent — mirroring the fork-PR skip-not-fail philosophy.
const REVIEW_SHEET_FILES = [
  { from: '01-model-comparison-panels.png', to: 'review-sheet-panels.png' },
  { from: '02-review-sheet-preview.png', to: 'review-sheet-preview.png' },
];
const reviewCaptured = [];
// Resolve the driver's credential requirements the SAME way the driver does
// (process env first, then .env.local) so the gate and the driver can never
// disagree about whether the review sheet can render.
const readLocalEnv = (name) => {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(resolve('.env.local'), 'utf8');
    const m = env.match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^"|"$/g, '') : undefined;
  } catch {
    return undefined;
  }
};
// Match the driver's resolution EXACTLY (no drift): verify-review-sheet.mjs
// reads FIREBASE_WEB_API_KEY from process.env only, NEXT_PUBLIC_FIREBASE_API_KEY
// from env then .env.local, and seed-live-data reads FIREBASE_SERVICE_ACCOUNT
// from env then .env.local. A looser gate (e.g. reading FIREBASE_WEB_API_KEY
// from .env.local) would pass while the driver immediately exits 1.
const reviewSheetReady = Boolean(
  process.env.FIREBASE_WEB_API_KEY || readLocalEnv('NEXT_PUBLIC_FIREBASE_API_KEY'),
) && Boolean(readLocalEnv('FIREBASE_SERVICE_ACCOUNT'));
if (!reviewSheetReady) {
  console.log('NOTE: review-sheet cells skipped (set FIREBASE_WEB_API_KEY + FIREBASE_SERVICE_ACCOUNT to render)');
} else {
  console.log(`\n[review-sheet] re-rendering the Model Comparison review sheet from ${reviewSheetAppArg}`);
  const tmp = `${outArg}/.review-sheet-tmp`;
  await rm(tmp, { recursive: true, force: true });
  const driver = spawn('node', ['scripts/verify-review-sheet.mjs', '--app', reviewSheetAppArg, '--out', tmp], {
    cwd: process.cwd(), stdio: 'inherit', env: process.env,
  });
  const code = await new Promise((resolvePromise) => driver.on('exit', resolvePromise));
  if (code !== 0) {
    console.log(`NOTE: review-sheet cells skipped (driver exited ${code})`);
  } else {
    for (const { from, to } of REVIEW_SHEET_FILES) {
      try {
        await copyFile(`${tmp}/${from}`, `${outArg}/${to}`);
        reviewCaptured.push({ route: 'review-sheet', theme: 'light', name: to });
        console.log(`captured ${to} (review sheet)`);
      } catch (err) {
        console.log(`NOTE: review-sheet cell ${to} skipped (${err.message})`);
      }
    }
  }
  await rm(tmp, { recursive: true, force: true });
}

// ── Deployments feed cell ───────────────────────────────────────────────────
// The live /deployments page (Vercel + Firebase rows with health checks)
// needs a signed-in user, which the demo-mode preview cannot provide — so this
// cell reuses the SHARED capture-deployments-feed.mjs driver against the LIVE
// app (production default, --deployments-feed-app to override) and copies its
// PNG into the gallery under the stable name. Runs only when the Firebase web
// API key the driver needs is present; skips with a NOTE (not a SKIP, so the
// shell wrapper's stale-gallery guard stays quiet) when absent — mirroring the
// review-sheet skip-not-fail philosophy.
const DEPLOYMENTS_FEED_FILE = { from: 'deployments-feed.png', to: 'deployments-feed.png' };
const feedCaptured = [];
// Same credential resolution the driver uses (env first, then .env.local) so
// the gallery gate and the driver can never disagree about whether the feed
// can render: capture-deployments-feed.mjs reads FIREBASE_WEB_API_KEY from
// process.env, NEXT_PUBLIC_FIREBASE_API_KEY from env then .env.local.
const deploymentsFeedReady = Boolean(
  process.env.FIREBASE_WEB_API_KEY || readLocalEnv('NEXT_PUBLIC_FIREBASE_API_KEY'),
);
if (!deploymentsFeedReady) {
  console.log('NOTE: deployments-feed cell skipped (set FIREBASE_WEB_API_KEY or NEXT_PUBLIC_FIREBASE_API_KEY to render)');
} else {
  console.log(`\n[deployments-feed] re-capturing the live Deployments feed from ${deploymentsFeedAppArg}`);
  const tmp = `${outArg}/.deployments-feed-tmp`;
  await rm(tmp, { recursive: true, force: true });
  const driver = spawn('node', ['scripts/capture-deployments-feed.mjs', '--app', deploymentsFeedAppArg, '--out', tmp], {
    cwd: process.cwd(), stdio: 'inherit', env: process.env,
  });
  const code = await new Promise((resolvePromise) => driver.on('exit', resolvePromise));
  if (code !== 0) {
    console.log(`NOTE: deployments-feed cell skipped (driver exited ${code})`);
  } else {
    try {
      await copyFile(`${tmp}/${DEPLOYMENTS_FEED_FILE.from}`, `${outArg}/${DEPLOYMENTS_FEED_FILE.to}`);
      feedCaptured.push({ route: 'deployments-feed', theme: 'light', name: DEPLOYMENTS_FEED_FILE.to });
      console.log(`captured ${DEPLOYMENTS_FEED_FILE.to} (deployments feed)`);
    } catch (err) {
      console.log(`NOTE: deployments-feed cell ${DEPLOYMENTS_FEED_FILE.to} skipped (${err.message})`);
    }
  }
  await rm(tmp, { recursive: true, force: true });
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
// The review-sheet pair has no light/dark twin; show them as a single row
// (both cells are single captures, not theme pairs).
const reviewHtml = reviewCaptured.length
  ? `
<section>
  <h2>Review Sheet (Model Comparison print-all)</h2>
  <div class="pair">${reviewCaptured.map((c) => fig(c, c.name === 'review-sheet-panels.png' ? 'Panels' : 'Preview window')).join('')}</div>
</section>`
  : '';
// The deployments-feed cell is a single live capture (no light/dark twin).
const feedHtml = feedCaptured.length
  ? `
<section>
  <h2>Deployments Feed (live Vercel + Firebase)</h2>
  <div class="pair">${feedCaptured.map((c) => fig(c, 'Live feed')).join('')}</div>
</section>`
  : '';

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
<main>${cellsHtml}${reviewHtml}${feedHtml}
</main>
</body>
</html>
`;

await writeFile(`${outArg}/screenshots.html`, sheet);
console.log(`contact sheet written to ${outArg}/screenshots.html`);
console.log(`\n${seen.size}/18 route cells + ${reviewCaptured.length} review-sheet cell${reviewCaptured.length === 1 ? '' : 's'} + ${feedCaptured.length} deployments-feed cell${feedCaptured.length === 1 ? '' : 's'} captured into ${outArg}/`);
ws.close();
chrome.kill();
