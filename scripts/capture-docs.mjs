#!/usr/bin/env node
/**
 * Capture the onboarding docs to PNGs: the README Handoff section and
 * docs/launch.md §4, rendered to full-page screenshots in headless Chrome.
 *
 * The gallery workflow (gallery.yml) runs this after the app-screenshot
 * capture so the artifact always ships the onboarding visuals alongside the
 * live-preview gallery. Unlike the gallery capture, it needs NO deployed
 * URL, NO secrets, and NO network — it renders the two markdown sections
 * from the working tree into a local HTML page and screenshots it, so it
 * still runs even where the Vercel-gated steps skip.
 *
 * Usage:
 *   node scripts/capture-docs.mjs                  # → screenshots/
 *   node scripts/capture-docs.mjs --out /tmp/docs  # different output dir
 *
 * Env: CHROME_PATH overrides the Chrome binary (CI wires setup-chrome's
 * output; the gallery capture uses the same convention). Exit 1 when a
 * section is missing or Chrome never comes up — a renamed heading must fail
 * loudly, not render an empty page.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { extractSection, renderMarkdown } from './markdown-html.mjs';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9445;
const VIEWPORT_W = 1200;
// The docs are tall; the driver resizes the viewport to the full content
// height before each capture so each PNG is the whole section, not a slice.
const MIN_H = 800;

const args = process.argv.slice(2);
const valOf = (flag) => {
  const eq = args.find((a) => a.startsWith(`${flag}=`))?.split('=').slice(1).join('=');
  if (eq) return eq;
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
};
const outArg = valOf('--out') ?? 'screenshots';

// ── Sections to render ──────────────────────────────────────────────────────
// Each is extracted from the live file by its heading, so a renamed section
// fails the capture (empty extract → exit 1 below) instead of silently
// shipping a blank PNG. The file paths mirror the drift guard's own reads.
const SECTIONS = [
  {
    file: 'README.md',
    start: '## Handoff',
    end: '## Screenshots',
    name: 'docs-handoff.png',
    title: 'README · Handoff — read this first',
  },
  {
    file: 'docs/launch.md',
    start: '## 4. The verification gates',
    end: '## 5.',
    name: 'docs-launch-gates.png',
    title: 'docs/launch.md · §4 The verification gates',
  },
];

const read = (p) => readFileSync(p, 'utf8');

// Render each section to a self-contained HTML page (no external assets, so a
// file:// or data: URL works with zero network). The inline <style> mirrors
// the docs' light-on-white look with GitHub-ish typography.
const pageHtml = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${title}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 48px 64px; background: #ffffff; color: #1f2328;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
         line-height: 1.6; font-size: 15px; }
  h1 { font-size: 30px; border-bottom: 1px solid #d8dee4; padding-bottom: 8px; }
  h2 { font-size: 24px; margin-top: 36px; border-bottom: 1px solid #d8dee4; padding-bottom: 6px; }
  h3 { font-size: 19px; margin-top: 28px; }
  h4 { font-size: 16px; margin-top: 22px; }
  p, li, blockquote { max-width: 900px; }
  code { background: #f6f8fa; border-radius: 6px; padding: 2px 5px;
         font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
  pre { background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 8px;
        padding: 16px; overflow-x: auto; }
  pre code { background: none; padding: 0; font-size: 13px; line-height: 1.45; }
  table { border-collapse: collapse; margin: 16px 0; max-width: 1000px; }
  th, td { border: 1px solid #d8dee4; padding: 8px 14px; text-align: left; vertical-align: top; }
  th { background: #f6f8fa; font-weight: 600; }
  blockquote { border-left: 4px solid #d0d7de; margin: 12px 0; padding: 4px 16px; color: #57606a; }
  a { color: #0969da; text-decoration: none; }
</style></head>
<body>
<h1>${title}</h1>
${body}
</body></html>`;

const pages = SECTIONS.map((s) => {
  const md = read(s.file);
  const section = extractSection(md, s.start, s.end);
  if (!section) {
    console.error(`✗ ${s.file}: section "${s.start}" not found — capture failed.`);
    process.exit(1);
  }
  return {
    name: s.name,
    title: s.title,
    html: pageHtml(s.title, renderMarkdown(section)),
  };
});

// ── Headless Chrome (same pattern as capture-gallery.mjs, incl. cleanup) ────
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/docs-capture-chrome',
  'about:blank',
], { stdio: 'ignore' });

const killChrome = () => { try { chrome.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('exit', killChrome);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => process.exit(130));
}
// Missing/broken Chrome binary: spawn emits 'error' instead of a clean exit.
// Surface a targeted message (CI wires setup-chrome's CHROME_PATH; the
// /Applications fallback only exists on macOS) instead of an unhandled crash.
chrome.on('error', (err) => {
  console.error(`✗ failed to launch Chrome at ${CHROME}: ${err.message}`);
  console.error('  Set CHROME_PATH to a working Chrome binary and re-run.');
  process.exit(1);
});

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
  width: VIEWPORT_W, height: MIN_H, deviceScaleFactor: 1, mobile: false,
});

await mkdir(outArg, { recursive: true });

for (const page of pages) {
  // data: URL so the page never touches the network (no server, no secrets).
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(page.html)}`;
  await send('Page.navigate', { url: dataUrl });
  await sleep(500); // let the page layout settle

  // Resize the viewport to the full content height, then capture the whole
  // section in one PNG.
  const state = await send('Runtime.evaluate', {
    expression: `document.documentElement.scrollHeight`,
    returnByValue: true,
  });
  const height = Math.max(MIN_H, Number(state.result.value) || MIN_H);
  await send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT_W, height, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(200);

  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(`${outArg}/${page.name}`, Buffer.from(shot.data, 'base64'));
  console.log(`captured ${outArg}/${page.name} (${VIEWPORT_W}×${height})`);
}

ws.close();
chrome.kill();
console.log(`\n${pages.length}/${pages.length} onboarding-doc PNGs captured into ${outArg}/`);
