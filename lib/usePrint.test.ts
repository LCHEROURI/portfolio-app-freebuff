import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openPrintPreview, usePrint } from './usePrint';
import type { PrintDoc } from './printDoc';

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

describe('usePrint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('falls back to the in-page recipe + window.print when the popup is blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    const { result } = renderHook(() => usePrint<PrintDoc>((p) => p));

    act(() => result.current.printReport(doc));

    // The payload is rendered into the in-page area for one frame...
    expect(result.current.printTarget).toEqual(doc);
    // ...then the dialog opens and the area is released.
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.printTarget).toBeNull());
  });
});
