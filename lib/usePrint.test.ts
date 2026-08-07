import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadPrintHtml, openPrintPreview, usePrint } from './usePrint';
import { buildPreviewHtml, type PrintDoc } from './printDoc';

const doc: PrintDoc = {
  title: 'Daily <Report>',
  meta: '2 attention items',
  callouts: [
    { heading: 'AI "summary"', label: 'DeepSeek Chat', text: 'Push <main> & ship.' },
  ],
  body: '# Body\n## Section & more',
};

const fakeWindow = () => {
  const write = vi.fn();
  const win = {
    document: { open: vi.fn(), write, close: vi.fn() },
    focus: vi.fn(),
  } as unknown as Window;
  return { win, write };
};

describe('openPrintPreview', () => {
  it('writes the standalone document into a new window and returns it', () => {
    const { win, write } = fakeWindow();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(win);

    const result = openPrintPreview(doc);

    expect(openSpy).toHaveBeenCalledWith('', '_blank', expect.stringContaining('width='));
    expect(win.document.open).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(expect.stringContaining('Daily &lt;Report&gt;'));
    expect(win.document.close).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
    expect(result).toBe(win);
  });

  it('returns null when the popup is blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openPrintPreview(doc)).toBeNull();
  });
});

describe('downloadPrintHtml', () => {
  // jsdom lacks URL.createObjectURL and blob: navigation, so a URL subclass
  // stubs the two statics (inheriting the real URL for any new URL() call) and
  // the anchor click is spied — the same approach the page tests use.
  const stubBlobWindow = () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:fake');
    const revokeObjectURL = vi.fn();
    class FakeURL extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal('URL', FakeURL as unknown as typeof URL);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    return { createObjectURL, revokeObjectURL, clickSpy };
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('downloads the EXACT standalone document the preview window writes', async () => {
    const { createObjectURL, clickSpy } = stubBlobWindow();

    downloadPrintHtml(doc);

    // The blob holds buildPreviewHtml(doc) verbatim — byte-identical to what a
    // preview window would render, so the saved file can never drift from the
    // preview. Assert content equality (not a size proxy) so escaping and
    // layout changes are caught.
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/html;charset=utf-8');
    expect(await blob.text()).toBe(buildPreviewHtml(doc));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('saves under the shared .html filename derived from the title slug', () => {
    const { clickSpy, revokeObjectURL } = stubBlobWindow();

    downloadPrintHtml({ title: "Today's Top Three", list: [{ number: 1, title: 'Ship onboarding' }] });

    // The anchor is removed from the DOM synchronously, so capture it from the
    // click spy's instance rather than querying the (already clean) DOM.
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('download')).toBe('today-s-top-three.html');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });
});

describe('usePrint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Shared setup for the fallback-path tests: block the popup so the hook
  // takes the in-page recipe, and capture the rAF callback so tests drive the
  // frame deterministically instead of waiting on real frames.
  const stubFallbackRaf = () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    let rafCallback: FrameRequestCallback | null = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });
    return {
      printSpy,
      fireFrame: () => act(() => rafCallback?.(0)),
    };
  };

  it('prefers the styled preview window and never opens the in-page recipe', () => {
    const { win, write } = fakeWindow();
    vi.spyOn(window, 'open').mockReturnValue(win);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    const { result } = renderHook(() => usePrint<PrintDoc>((p) => p));

    act(() => result.current.printReport(doc));

    // The preview window received the document; the in-page area stays empty
    // and the browser dialog never opens directly.
    expect(write).toHaveBeenCalledTimes(1);
    expect(printSpy).not.toHaveBeenCalled();
    expect(result.current.printTarget).toBeNull();
  });

  it('locks the fallback lifecycle: payload set, rAF fires window.print, payload released', () => {
    const { printSpy, fireFrame } = stubFallbackRaf();

    const { result } = renderHook(() => usePrint<PrintDoc>((p) => p));

    act(() => result.current.printReport(doc));

    // 1) Payload is rendered into the in-page area...
    expect(result.current.printTarget).toEqual(doc);
    // ...but the dialog is deferred to the next frame — not opened synchronously.
    expect(printSpy).not.toHaveBeenCalled();

    // 2) The frame fires: the dialog opens...
    fireFrame();
    expect(printSpy).toHaveBeenCalledTimes(1);
    // 3) ...and the payload is released.
    expect(result.current.printTarget).toBeNull();
  });

  it('drops the stale state update when the fallback rAF callback fires after unmount', () => {
    const { printSpy, fireFrame } = stubFallbackRaf();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result, unmount } = renderHook(() => usePrint<PrintDoc>((p) => p));

    act(() => result.current.printReport(doc));
    expect(result.current.printTarget).toEqual(doc);

    // Unmount before the frame fires — the scheduled callback is now stale.
    unmount();

    // React 18+ silently drops state updates on unmounted components, so firing
    // the stale callback must not throw. Only the React "state update on
    // unmounted component" warning would be a regression; other console noise
    // is none of this test's business, so assert on that specific message.
    expect(() => fireFrame()).not.toThrow();
    const errors = errorSpy.mock.calls.flat().join(' ');
    expect(errors).not.toMatch(/unmounted component/i);
    // The print itself still fires (the user asked to print); only the state
    // bookkeeping is discarded.
    expect(printSpy).toHaveBeenCalledTimes(1);
  });
});
