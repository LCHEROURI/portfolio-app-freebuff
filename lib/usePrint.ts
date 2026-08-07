'use client';

import { useCallback, useState } from 'react';

import { buildPreviewHtml, printHtmlFileName, type PrintDoc } from './printDoc';

// ============================================================================
// Shared client print flow for the app's printable surfaces (Reports page,
// Command Center's Today's Top Three briefing).
//
// Preferred path: printReport() opens a NEW WINDOW with a styled preview of
// exactly what will hit the paper — the same layout, fonts, wrapping, and
// @page margins the print dialog uses, plus a Print button in the preview's
// toolbar. The user reviews the preview before the browser dialog ever opens.
//
// Fallback: when the popup is blocked (window.open returns null), the payload
// is rendered into the in-page .print-report area (the @media print recipe in
// app/globals.css) and window.print() runs directly.
//
// All text is HTML-escaped when the preview document is written, so report
// bodies and AI narration (arbitrary text) can never inject markup into the
// preview window. The document builders live in lib/printDoc.ts (shared with
// the server PDF route), so the preview, the fallback, and the downloaded PDF
// can never drift.
// ============================================================================

/** Open a new window with the styled preview. Returns the window, or null when
 *  the popup was blocked (the caller falls back to the in-page recipe). */
export const openPrintPreview = (doc: PrintDoc): Window | null => {
  const win = window.open('', '_blank', 'width=860,height=940');
  if (!win) return null;
  win.document.open();
  win.document.write(buildPreviewHtml(doc));
  win.document.close();
  win.focus();
  return win;
};

/** Save the SAME standalone preview document as a downloadable .html file.
 *  Pure client-side — no route, no auth, no printer: buildPreviewHtml output
 *  becomes a blob, and an <a download> saves it under the shared HTML filename.
 *  Because it renders the identical document the preview window writes, the
 *  saved file can never drift from what the user reviewed on screen. */
export const downloadPrintHtml = (doc: PrintDoc): void => {
  const blob = new Blob([buildPreviewHtml(doc)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = printHtmlFileName(doc);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

/**
 * Shared print lifecycle. buildDoc converts a surface's payload into the
 * PrintDoc the preview window renders. printReport prefers the styled preview
 * window; only when the popup is blocked does it fall back to the in-page
 * .print-report recipe + window.print().
 *
 * buildDoc must be a stable, module-level function: it is a useCallback
 * dependency, so an inline arrow passed here would recreate printReport on
 * every render.
 */
export function usePrint<T>(buildDoc: (payload: T) => PrintDoc) {
  const [printTarget, setPrintTarget] = useState<T | null>(null);

  const printReport = useCallback((payload: T) => {
    const doc = buildDoc(payload);
    // Preferred path: a styled preview window the user reviews before the
    // browser dialog opens.
    if (openPrintPreview(doc)) return;
    // Popup blocked: fall back to the in-page recipe.
    setPrintTarget(payload);
    requestAnimationFrame(() => {
      window.print();
      setPrintTarget(null);
    });
  }, [buildDoc]);

  return { printTarget, printReport };
}
