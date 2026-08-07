// ============================================================================
// lib/printDoc.ts — shared, framework-agnostic print-document model.
//
// NOT a 'use client' module: it is imported by the client hook
// (lib/usePrint.ts) AND the server PDF route (app/api/print/pdf/route.ts), so
// the preview window, the in-page print fallback, and the downloaded PDF all
// render from the SAME document builder and can never drift. Pure string /
// object transforms: no React, no I/O.
//
// PrintDoc is derived from the zod schema (PrintDocSchema) so the server's
// validation and the client's type are the same source of truth.
// ============================================================================

import { z } from 'zod';

import { modelLabel } from './labels';

export const PrintCalloutSchema = z.object({
  heading: z.string().min(1).max(120),
  /** Friendly model label shown next to the heading, when present. */
  label: z.string().max(120).optional(),
  text: z.string().min(1).max(20_000),
});

export const PrintListItemSchema = z.object({
  number: z.number().int().min(1),
  title: z.string().min(1).max(300),
  project: z.string().max(300).optional(),
  detail: z.string().max(2_000).optional(),
});

/** Structured content for the print preview. All fields are raw text; they are
 *  escaped once, when the preview document is written. */
export const PrintDocSchema = z.object({
  title: z.string().min(1).max(300),
  meta: z.string().max(300).optional(),
  callouts: z.array(PrintCalloutSchema).max(10).optional(),
  /** Monospace report body (Reports page). Mutually exclusive with list. */
  body: z.string().max(100_000).optional(),
  /** Ranked list (Today's Top Three briefing). Mutually exclusive with body. */
  list: z.array(PrintListItemSchema).max(50).optional(),
});

export type PrintCallout = z.infer<typeof PrintCalloutSchema>;
export type PrintListItem = z.infer<typeof PrintListItemSchema>;
export type PrintDoc = z.infer<typeof PrintDocSchema>;

/** HTML-escape a value for safe interpolation into the preview document. */
export const escapeHtml = (value: string | null | undefined): string =>
  (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// The meta lines below are the ONLY computed strings shared between the two
// render paths (the string-based preview document and the in-page .print-report
// fallback JSX). Both paths must call these builders — never inline their own
// copy — so the preview and the fallback can never drift.

/** Meta line for a report print (kind · attention count · optional age). */
export const reportPrintMeta = (input: {
  kind: string;
  attentionCount: number;
  ageLabel?: string;
}): string =>
  `${input.kind} report · ${input.attentionCount} attention items${input.ageLabel ? ` · ${input.ageLabel}` : ''}`;

/** Meta line for a Today's Top Three briefing print (action count). */
export const briefingPrintMeta = (actionCount: number): string =>
  `${actionCount} priority ${actionCount === 1 ? 'action' : 'actions'}`;

/** Meta line for an AI winner recommendation print (recommended version). */
export const recommendationPrintMeta = (recommendedVersionName: string): string =>
  `AI winner recommendation · Recommended: ${recommendedVersionName}`;

/** Payload for an AI winner recommendation print. Shared by the Model
 *  Comparison panels and the project detail Overview tab, so both surfaces
 *  resolve the same fields before calling buildRecommendationPrintDoc. */
export interface PrintRecommendation {
  projectName: string;
  recommendedVersionName: string;
  note: string;
  model: string;
}

/** Map a project's AI winner recommendation to the shared print-preview
 *  document: the note becomes a callout with the friendly model label. Shared
 *  by EVERY surface that prints a winner recommendation (Model Comparison, the
 *  project detail Overview tab) — never inline a copy. The recommendation is
 *  printed as it reads on screen (editable draft wins over the saved note). */
export const buildRecommendationPrintDoc = (payload: PrintRecommendation): PrintDoc => ({
  title: `${payload.projectName} — AI winner recommendation`,
  // Shared builder — the in-page .print-report fallback calls the same
  // function, so the two render paths can never drift.
  meta: recommendationPrintMeta(payload.recommendedVersionName),
  callouts: payload.note
    ? [{ heading: 'AI winner recommendation', label: modelLabel(payload.model), text: payload.note }]
    : [],
});

/** Meta line for the all-projects review sheet (recommendation count). */
export const allRecommendationsPrintMeta = (count: number): string =>
  `${count} AI winner ${count === 1 ? 'recommendation' : 'recommendations'} across all projects`;

/** Build ONE review-sheet document listing every project's AI winner
 *  recommendation: the project, the recommended version, the note, and the
 *  friendly model label. Shared by the Model Comparison 'Print all' button
 *  and its in-page fallback — the fallback renders THIS document's list, so
 *  the preview and the fallback can never drift. */
export const buildAllRecommendationsPrintDoc = (items: PrintRecommendation[]): PrintDoc => ({
  title: 'AI winner recommendations — all projects',
  // Shared builder — the in-page .print-report fallback renders the exact
  // list below, so the two render paths can never drift.
  meta: allRecommendationsPrintMeta(items.length),
  list: items.map((item, i) => {
    const label = item.model ? ` (${modelLabel(item.model)})` : '';
    const detail = item.note ? `${item.note}${label}` : label.trim() || undefined;
    // Deliberate field mapping for the review sheet: the numbered entry is the
    // PROJECT, the muted span carries the recommended version, and the note
    // (with the friendly model label) is the detail line. Both the preview and
    // the in-page fallback render these SAME fields, so the mapping is the
    // contract — never rearrange one path without the other.
    return {
      number: i + 1,
      title: item.projectName,
      project: `Recommended: ${item.recommendedVersionName}`,
      detail,
    };
  }),
});

/** Standalone stylesheet for the preview window. The .paper sheet mirrors the
 *  print layout (white sheet, dark text, wrapped monospace body); the toolbar
 *  is hidden in @media print so what you see on screen is what hits the
 *  paper. The same @media print rules apply when Chrome renders the document
 *  to PDF server-side, so the downloaded file matches the preview. */
const PREVIEW_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #eceef0; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1f2937; }
  .toolbar {
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; gap: 10px;
    padding: 10px 16px; background: #fff; border-bottom: 1px solid #d8dde1;
  }
  .toolbar .preview-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toolbar button { border: 1px solid #d8dde1; border-radius: 8px; background: #fff; padding: 6px 14px; font-size: 13px; font-weight: 500; cursor: pointer; }
  .toolbar .btn-print { background: #e94b23; border-color: #e94b23; color: #fff; }
  .paper { max-width: 800px; margin: 24px auto; padding: 48px 56px; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .paper h1 { margin: 0 0 4px; font-size: 24px; line-height: 1.25; }
  .paper .meta { margin: 0 0 20px; font-size: 12px; color: #6b7280; }
  .paper .callout { margin: 0 0 20px; padding: 12px 14px; border: 1px solid #ddd6fe; border-radius: 8px; background: #faf8ff; }
  .paper .callout strong { display: block; font-size: 12px; color: #6d28d9; text-transform: uppercase; letter-spacing: 0.04em; }
  .paper .callout .label { font-size: 12px; color: #6d28d9; }
  .paper .callout p { margin: 6px 0 0; font-size: 14px; line-height: 1.55; }
  .paper pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.6; }
  .paper ol { margin: 0; padding-left: 22px; }
  .paper ol li { margin: 0 0 12px; font-size: 14px; line-height: 1.5; }
  .paper ol li .muted { font-size: 12px; color: #6b7280; }
  @media print {
    html, body { background: #fff; }
    .toolbar { display: none; }
    .paper { margin: 0; max-width: none; box-shadow: none; padding: 0; }
    @page { margin: 0.75in; }
  }
`;

/** Build the full standalone preview document (toolbar + paper + print CSS). */
export const buildPreviewHtml = (doc: PrintDoc): string => {
  const title = escapeHtml(doc.title);
  const meta = doc.meta ? `<p class="meta">${escapeHtml(doc.meta)}</p>` : '';
  const callouts = (doc.callouts ?? [])
    .map(
      (c) =>
        `<div class="callout">`
        + `<strong>${escapeHtml(c.heading)}</strong>`
        + (c.label ? ` <span class="label">(${escapeHtml(c.label)})</span>` : '')
        + `<p>${escapeHtml(c.text)}</p>`
        + `</div>`,
    )
    .join('\n');
  // body and list are mutually exclusive per the PrintDoc contract; if a
  // caller supplies both, body wins so the paper never renders two content
  // blocks for one document.
  const body = doc.body !== undefined ? `<pre>${escapeHtml(doc.body)}</pre>` : '';
  const list = doc.body === undefined && (doc.list ?? []).length > 0
    ? `<ol>${doc.list!.map((item) =>
        `<li><strong>${item.number}. ${escapeHtml(item.title)}</strong>`
        + (item.project ? ` <span class="muted">· ${escapeHtml(item.project)}</span>` : '')
        + (item.detail ? `<div class="muted">${escapeHtml(item.detail)}</div>` : '')
        + `</li>`,
      ).join('\n')}</ol>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>${PREVIEW_CSS}</style>
</head>
<body>
  <div class="toolbar">
    <span class="preview-title">${title}</span>
    <button type="button" class="btn-print" onclick="window.print()">Print</button>
    <button type="button" onclick="window.close()">Close</button>
  </div>
  <div class="paper">
    <h1>${title}</h1>
    ${meta}
    ${callouts}
    ${body}
    ${list}
  </div>
</body>
</html>`;
};

/** Slugify a print title into a safe filename stem (lowercase alphanumerics
 *  joined by hyphens, capped at 60 chars). Shared by the PDF and HTML filename
 *  builders so both download paths derive the SAME stem from the same title. */
export const printTitleSlug = (doc: Pick<PrintDoc, 'title'>): string =>
  doc.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/** A safe, human-readable PDF filename derived from the document title. Used by
 *  BOTH the server route (Content-Disposition) and the client download helper
 *  (<a download>), so the saved file always has the same name. */
export const printPdfFileName = (doc: Pick<PrintDoc, 'title'>): string =>
  `${printTitleSlug(doc) || 'print'}.pdf`;

/** A safe, human-readable standalone-HTML filename derived from the document
 *  title — the 'Save as HTML' counterpart to printPdfFileName, sharing the
 *  same slug stem so the two export formats always carry matching names. */
export const printHtmlFileName = (doc: Pick<PrintDoc, 'title'>): string =>
  `${printTitleSlug(doc) || 'print'}.html`;
