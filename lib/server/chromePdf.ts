// ============================================================================
// lib/server/chromePdf.ts — server-side headless-Chrome PDF renderer.
//
// Reuses the exact CDP driver pattern the capture scripts use
// (scripts/capture-docs.mjs, scripts/capture-gallery.mjs, …): spawn a real
// headless Chrome with a remote-debugging port, poll /json/list for the page
// target's WebSocket, then drive it over CDP. Instead of Page.captureScreenshot
// it calls Page.printToPDF, which renders the document through Chrome's print
// engine — honoring @media print, @page margins, fonts, and wrapping exactly
// like the browser print dialog.
//
// The input is the SAME standalone HTML the client preview window renders
// (lib/printDoc.ts buildPreviewHtml), so the downloaded PDF can never drift
// from the on-screen preview.
//
// Env: CHROME_PATH overrides the Chrome binary (CI and local macOS default).
// Node ≥ 22 provides the global WebSocket this driver uses — the same runtime
// the capture scripts require. Where Chrome is unavailable (e.g. some
// serverless runtimes) renderHtmlToPdf throws ChromePdfUnavailableError and
// the route surfaces it as a targeted 503 instead of a generic 500.
//
// Self-cleanup contract (same as the capture scripts): Chrome is killed and
// its unique profile dir removed on EVERY exit path — normal completion,
// thrown errors, and process exit — so a crashed run never leaks a stray
// Chrome or a /tmp profile.
// ============================================================================

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Error thrown when headless Chrome cannot be launched at all (missing
 *  binary, broken install). The route maps this to a 503 so the caller can
 *  show a targeted message instead of a generic 500. */
export class ChromePdfUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChromePdfUnavailableError';
  }
}

const fetchJson = async (url: string) => (await fetch(url)).json();

/**
 * Parse the DevTools listening line Chrome prints to stderr when launched with
 * --remote-debugging-port=0 (Chrome picks a free port itself, so concurrent
 * route calls can never collide on a fixed port):
 *   DevTools listening on ws://127.0.0.1:45011/devtools/browser/…
 */
export const parseDevToolsPort = (stderr: string): number | null => {
  const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
  return match ? Number(match[1]) : null;
};

// One exit-handler for the whole module kills every in-flight Chrome on
// process exit (signals included), so a long-running dev server never
// accumulates per-request listeners and a crashed render still cleans up.
const activeChromes = new Set<ReturnType<typeof spawn>>();
process.on('exit', () => {
  // Array.from keeps this ES5-safe (the repo's tsconfig predates Set
  // iteration without downlevelIteration).
  for (const chrome of Array.from(activeChromes)) {
    try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
  }
});

/** Render a standalone HTML document to PDF bytes via headless Chrome's print
 *  engine (Page.printToPDF). */
export const renderHtmlToPdf = async (html: string): Promise<Buffer> => {
  const profileDir = await mkdtemp(join(tmpdir(), 'print-pdf-chrome-'));

  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    // Port 0 → Chrome picks a free port and prints it to stderr; the capture
    // scripts use fixed ports, but a server route can serve concurrent calls.
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  activeChromes.add(chrome);

  // Hoisted so cleanup can close the DevTools socket on every exit path.
  let ws: WebSocket | null = null;
  const cleanup = () => {
    activeChromes.delete(chrome);
    if (ws) { try { ws.close(); } catch { /* already closed */ } }
    try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
    try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  };

  let stderrBuf = '';
  chrome.stderr?.on('data', (chunk) => { stderrBuf += String(chunk); });

  // Missing/broken Chrome binary: spawn emits 'error' instead of a clean exit.
  // Surface a targeted message (CI wires setup-chrome's CHROME_PATH; the
  // /Applications fallback only exists on macOS) instead of an unhandled crash.
  const chromeFailed = new Promise<never>((_, reject) => {
    chrome.on('error', (err) => {
      reject(new ChromePdfUnavailableError(
        `Failed to launch headless Chrome at ${CHROME}: ${err.message}. Set CHROME_PATH to a working Chrome binary and re-run.`,
      ));
    });
  });

  // Port waiter: bail as soon as Chrome exits so a crash never burns the full
  // 20s poll window. The race outcome is the only one that matters — the loop
  // has no cancellation handle, so its late rejection is suppressed to keep it
  // from surfacing as an unhandled promise rejection.
  const waitForPort = (async () => {
    for (let i = 0; i < 80; i++) {
      if (chrome.exitCode !== null) {
        throw new ChromePdfUnavailableError('Chrome exited before reporting a debugging port.');
      }
      const parsed = parseDevToolsPort(stderrBuf);
      if (parsed) return parsed;
      await sleep(250);
    }
    throw new ChromePdfUnavailableError('Chrome DevTools never reported a debugging port.');
  })();
  waitForPort.catch(() => { /* the race outcome decides; never unhandled */ });

  try {
    // Wait for Chrome to report its chosen debugging port (or fail fast).
    const port = await Promise.race([waitForPort, chromeFailed]);

    // Resolve the page target's WebSocket URL (same poll as the capture scripts).
    let wsUrl: string | null = null;
    for (let i = 0; i < 40 && !wsUrl; i++) {
      try {
        const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
        wsUrl = list.find((t: { type: string }) => t.type === 'page')?.webSocketDebuggerUrl ?? null;
      } catch { /* still starting */ }
      if (!wsUrl) await sleep(250);
    }
    if (!wsUrl) {
      throw new ChromePdfUnavailableError('Chrome DevTools did not expose a page target.');
    }

    ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => { ws!.onopen = resolve; ws!.onerror = reject; });

    let msgId = 0;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    // If Chrome dies mid-send, reject every in-flight CDP call so the route
    // fails fast instead of hanging until the platform maxDuration.
    const rejectAllPending = (reason: string) => {
      const err = new Error(reason);
      for (const { reject } of Array.from(pending.values())) reject(err);
      pending.clear();
    };
    ws.onclose = () => rejectAllPending('Chrome DevTools closed before the PDF was ready.');
    ws.onerror = () => rejectAllPending('Chrome DevTools error before the PDF was ready.');
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id)!;
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise((resolve, reject) => {
        const id = ++msgId;
        pending.set(id, { resolve, reject });
        ws!.send(JSON.stringify({ id, method, params }));
      });

    // data: URL so the page never touches the network (no server, no secrets).
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await send('Page.navigate', { url: dataUrl });
    await sleep(500); // let the page layout settle

    // Chrome's print engine — honors @media print + @page from the document.
    const result = await send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
    }) as { data: string };
    return Buffer.from(result.data, 'base64');
  } finally {
    cleanup();
  }
};
