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
 *   node scripts/capture-docs.mjs --check          # fail if committed PNGs would change
 *
 * --check is the pre-push gate mode: it renders the same sections into a
 * throwaway temp dir and byte-compares them with the committed PNGs, so a
 * doc edit that would alter the onboarding visuals FAILS with guidance to
 * re-capture and commit, instead of shipping a gallery whose onboarding
 * pictures silently drift from the docs. Exits 0 when every committed PNG
 * matches (or when there is no committed baseline to compare — skip, never
 * fail, matching the hook's contract), 1 when any would change.
 *
 * Env: CHROME_PATH overrides the Chrome binary (CI wires setup-chrome's
 * output; the gallery capture uses the same convention). Exit 1 when a
 * section is missing or Chrome never comes up — a renamed heading must fail
 * loudly, not render an empty page.
 */
import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
// --check (the pre-push gate): render into a temp dir and compare against the
// committed PNGs in outArg, failing when any would change.
const isCheck = args.includes('--check');

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
  /* Image references render as the alt text (the renderer deliberately does
     not inline the PNG bytes — a data: URL page cannot load a relative src,
     and inlining would compound across regenerations). Style it so the
     reference reads as an intentional caption in the captured PNG. */
  .doc-img { font-style: italic; color: #57606a; background: #f6f8fa;
             border: 1px dashed #d0d7de; border-radius: 6px; padding: 1px 8px; }
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
  // GitHub-hosted runners run Chromium without a usable sandbox; these flags
  // let headless Chrome start there (and are harmless on macOS) — same
  // convention as verify-prod-signin.mjs / verify-review-sheet.mjs.
  '--no-sandbox',
  '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/docs-capture-chrome',
  'about:blank',
], { stdio: 'ignore' });

// The --check temp dir is created later in the script; a `let` here lets the
// exit handler reach it. Cleaning up on EVERY exit path (normal completion,
// process.exit, uncaught render-loop errors, signal) means a crashed run never
// leaves a docs-capture-check-* dir behind — same self-cleanup contract as the
// gallery capture's trap. rmSync keeps the handler synchronous, as exit
// handlers must be.
let tempRenderDir = null;
const cleanup = () => {
  try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
  if (tempRenderDir) {
    try { rmSync(tempRenderDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
};
process.on('exit', cleanup);
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
// 15s window (60 × 250ms): Chrome on a cold GitHub runner — especially mid
// full-suite load — can take longer than the 10s this used to allow before
// the DevTools endpoint answers.
for (let i = 0; i < 60 && !wsUrl; i++) {
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

// In --check mode render into a throwaway temp dir so the committed PNGs are
// never touched; the compare step below then diffs fresh vs committed. The
// exit handler above removes it on any exit path.
const renderDir = isCheck ? await mkdtemp(join(tmpdir(), 'docs-capture-check-')) : outArg;
tempRenderDir = isCheck ? renderDir : null;
await mkdir(renderDir, { recursive: true });

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
  await writeFile(`${renderDir}/${page.name}`, Buffer.from(shot.data, 'base64'));
  console.log(`captured ${renderDir}/${page.name} (${VIEWPORT_W}×${height})`);
}

ws.close();
chrome.kill();

// ── --check: diff the fresh renders against the committed PNGs ─────────────
// The gate's contract: a doc edit that would change the rendered onboarding
// visuals must FAIL the push (with guidance to re-capture and commit), so the
// committed PNGs never silently drift from the docs they picture. Byte
// comparison, matching capture-screenshots.sh's --diff semantics.
if (isCheck) {
  const changed = [];
  const skipped = [];
  for (const page of pages) {
    // Baseline read is its OWN try: only a genuinely absent committed PNG is
    // a 'skip' — a missing FRESH render (capture failed) must be a hard error,
    // never silently conflated with a missing baseline.
    let baseline;
    try {
      baseline = await readFile(`${outArg}/${page.name}`);
    } catch {
      skipped.push(page.name);
      console.log(`— ${page.name} has no committed baseline in ${outArg}/ (skip)`);
      continue;
    }
    let fresh;
    try {
      fresh = await readFile(`${renderDir}/${page.name}`);
    } catch (err) {
      console.error(`✗ ${page.name}: fresh render missing after capture — ${err.message}`);
      process.exit(1);
    }
    if (baseline.equals(fresh)) {
      console.log(`✓ ${page.name} matches the committed render`);
    } else {
      changed.push(page.name);
      console.log(`✗ ${page.name} WOULD CHANGE (a doc edit altered the onboarding visuals)`);
    }
  }

  if (changed.length > 0) {
    console.error(`\n✗ docs-render gate FAILED: ${changed.length} PNG(s) would change — run 'npm run capture:docs' and commit the updated PNGs.`);
    process.exit(1);
  }
  if (skipped.length === pages.length) {
    console.log(`\n— docs-render gate skipped: no committed baseline PNGs in ${outArg}/ (run 'npm run capture:docs' once and commit them).`);
    process.exit(0);
  }
  // Mixed case (some baselines missing, none changed) still passes, but the
  // message names the skips so PASS is never read as 'all baselines existed'.
  const skipNote = skipped.length > 0 ? ` (${skipped.length} baseline(s) missing, skipped)` : '';
  console.log(`\n✓ docs-render gate PASS — committed onboarding PNGs match the current docs${skipNote}.`);
  process.exit(0);
}

console.log(`\n${pages.length}/${pages.length} onboarding-doc PNGs captured into ${outArg}/`);
