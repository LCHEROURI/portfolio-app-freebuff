import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChromePdfUnavailableError, parseDevToolsPort, resolveChromeBinary } from './chromePdf';

// The @sparticuz/chromium import must never be real in tests: the linux
// binary cannot run on macOS, so the mock provides a fake executablePath.
vi.mock('@sparticuz/chromium', () => ({
  default: {
    executablePath: vi.fn().mockResolvedValue('/bundled/chromium'),
    args: ['--no-sandbox', "--headless='shell'", '--single-process'],
  },
}));

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

  it('resolves the binary in tiers: CHROME_PATH → macOS default → bundled serverless Chromium', () => {
    // The Vercel 503 fix: the resolver must prefer CHROME_PATH, keep the
    // macOS dev fallback, and fall through to @sparticuz/chromium on Linux
    // serverless instead of pointing at a binary that does not exist there.
    expect(script).toContain("if (process.env.CHROME_PATH) return { path: process.env.CHROME_PATH, bundled: false };");
    expect(script).toContain("if (process.platform === 'darwin') return { path: MACOS_CHROME, bundled: false };");
    expect(script).toContain("await import('@sparticuz/chromium')");
    expect(script).toContain('chromium.executablePath()');
  });

  it('never passes --headless=new to the bundled headless shell (unsupported mode)', () => {
    // The sparticuz shell has no 'new' headless mode; --headless=new must be
    // confined to the real-Chrome branch of the args ternary.
    expect(script).toMatch(/bundled && bundledArgs \? bundledArgs : \['--headless=new', '--disable-gpu'\]/);
  });
});

describe('resolveChromeBinary (unit)', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const setPlatform = (value: string) => {
    Object.defineProperty(process, 'platform', { value, configurable: true });
  };

  beforeEach(() => {
    delete process.env.CHROME_PATH;
  });
  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    delete process.env.CHROME_PATH;
  });

  it('returns CHROME_PATH verbatim on any platform (CI/local override wins)', async () => {
    setPlatform('linux');
    process.env.CHROME_PATH = '/ci/chrome'; // must beat the bundled fallback
    const bin = await resolveChromeBinary();
    expect(bin).toEqual({ path: '/ci/chrome', bundled: false });
  });

  it('keeps the macOS system Chrome on darwin (sparticuz is linux-only)', async () => {
    setPlatform('darwin');
    const bin = await resolveChromeBinary();
    expect(bin).toEqual({ path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', bundled: false });
  });

  it('uses the bundled @sparticuz/chromium headless shell on linux serverless', async () => {
    setPlatform('linux');
    const bin = await resolveChromeBinary();
    expect(bin.path).toBe('/bundled/chromium');
    expect(bin.bundled).toBe(true);
    expect(bin.args).toContain('--no-sandbox');
    expect(bin.args).toContain("--headless='shell'");
  });
});

describe('next.config.mjs · serverless Chromium wiring', () => {
  const config = readFileSync('next.config.mjs', 'utf8');

  it('keeps @sparticuz/chromium external to the server bundle (Next 14 key)', () => {
    expect(config).toContain("serverComponentsExternalPackages: ['@sparticuz/chromium']");
  });

  it('traces the bin/ dir into the /api/print/pdf function bundle', () => {
    expect(config).toContain("'/api/print/pdf': ['node_modules/@sparticuz/chromium/bin/**']");
  });
});
