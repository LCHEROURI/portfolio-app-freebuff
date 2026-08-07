import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ChromePdfUnavailableError, parseDevToolsPort } from './chromePdf';

// ============================================================================
// lib/server/chromePdf.test.ts — lock the headless-Chrome PDF driver contract.
//
// The pure helper (parseDevToolsPort) is unit-tested directly. The driver's
// CDP surface is contract-locked by reading the real module from disk (the
// same approach scripts/capture-docs.test.ts uses for its script), so a future
// edit that changes how the PDF is captured — or breaks the self-cleanup /
// error contract — fails here instead of silently shipping a broken route.
// ============================================================================

const SCRIPT_PATH = 'lib/server/chromePdf.ts';
const script = readFileSync(SCRIPT_PATH, 'utf8');

describe('parseDevToolsPort', () => {
  it('extracts the port Chrome prints when launched with port 0', () => {
    expect(parseDevToolsPort('DevTools listening on ws://127.0.0.1:45011/devtools/browser/abc')).toBe(45011);
  });

  it('returns null when the listening line has not appeared yet', () => {
    expect(parseDevToolsPort('some other stderr output')).toBeNull();
    expect(parseDevToolsPort('')).toBeNull();
  });
});

describe('ChromePdfUnavailableError', () => {
  it('carries the name the route matches on', () => {
    const err = new ChromePdfUnavailableError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ChromePdfUnavailableError');
    expect(err.message).toBe('boom');
  });
});

describe('lib/server/chromePdf.ts · CDP PDF driver contract', () => {
  it('launches headless Chrome with a per-call ephemeral debugging port', () => {
    expect(script).toContain("'--headless=new'");
    expect(script).toContain('--remote-debugging-port=0');
    // Per-call port 0 (Chrome picks a free one) instead of a fixed port, so
    // concurrent route calls can never collide.
    expect(script).toContain('parseDevToolsPort');
  });

  it('captures via Page.printToPDF (not a screenshot)', () => {
    expect(script).toContain("send('Page.printToPDF'");
    expect(script).toContain('printBackground: true');
    expect(script).toContain('preferCSSPageSize: true');
    expect(script).not.toContain("'Page.captureScreenshot'");
  });

  it('navigates to a data: URL so the render never touches the network', () => {
    expect(script).toContain('data:text/html;charset=utf-8');
    expect(script).toContain('encodeURIComponent(html)');
  });

  it('throws ChromePdfUnavailableError (not a generic error) when Chrome is missing', () => {
    expect(script).toContain("chrome.on('error'");
    expect(script).toContain('new ChromePdfUnavailableError');
  });

  it('bails the port waiter when Chrome exits early and suppresses its late rejection', () => {
    // A crashed Chrome must never burn the full 20s poll window, and the
    // detached waiter's late rejection must never surface unhandled.
    expect(script).toContain('chrome.exitCode !== null');
    expect(script).toContain('waitForPort.catch');
  });

  it('rejects in-flight CDP calls when Chrome dies mid-send', () => {
    // A hang here would burn the route's maxDuration; it must fail fast.
    expect(script).toContain('ws.onclose');
    expect(script).toContain('ws.onerror');
    expect(script).toContain('rejectAllPending');
    expect(script).toContain('pending.clear()');
  });

  it('closes the DevTools WebSocket in cleanup alongside Chrome + the profile dir', () => {
    expect(script).toContain('if (ws) { try { ws.close(); }');
  });

  it('cleans up Chrome + the profile dir on every exit path', () => {
    expect(script).toContain("chrome.kill('SIGKILL')");
    expect(script).toContain('rmSync(profileDir, { recursive: true, force: true })');
    expect(script).toContain('process.on(\'exit\'');
    expect(script).toContain('activeChromes');
  });
});
