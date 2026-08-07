// ============================================================================
// scripts/markdown-html.mjs — dependency-free markdown → HTML for the
// onboarding docs.
//
// capture-docs.mjs renders the README Handoff section and docs/launch.md §4 to
// PNGs in headless Chrome. Those sections use a small markdown subset —
// ATX headings, paragraphs, pipe tables, fenced code blocks (the ASCII
// pipeline diagrams), unordered/ordered lists, blockquotes, and inline
// code/bold/links — so this module renders exactly that subset with zero
// dependencies instead of pulling a markdown library into the repo. Pure
// string-in/string-out: no I/O, no imports, unit-testable in isolation.
//
// Escaping: raw HTML in the source docs is escaped (never passed through), so
// the renderer is safe to use on any markdown file in the tree. Inline
// patterns (code/bold/links) are applied AFTER escaping, so their markers can
// never inject markup of their own.
// ============================================================================

const escapeHtml = (s) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const INLINE_CODE_RE = /`([^`]+)`/g;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
// Image reference: `![alt](path)`. Consumed BEFORE the link pattern so the
// leading `!` is never left behind and the path is never turned into a
// clickable link. Emitted as a styled span — NOT an <img>: the capture renders
// into a data: URL page where a relative src cannot resolve, and inlining the
// actual PNG bytes would compound image data into the section PNG on every
// regeneration (docs-handoff.png would embed its own previous generation),
// breaking the --check byte-diff gate. The alt text keeps the reference
// visible in the rendered PNG.
const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
// Placeholder for a code span while bold/links run, so a code span containing
// `**` or `[` can never be corrupted by the later patterns (real markdown
// keeps code spans atomic). NUL can't appear in source text.
const CODE_PLACEHOLDER = '\u0000';

/**
 * Apply the inline patterns (code, bold, links) to an already-escaped line.
 * Code spans are extracted to placeholders FIRST so bold/link patterns can't
 * reach inside them, then restored after.
 */
export const renderInline = (text) => {
  const codes = [];
  const protectedText = text.replace(INLINE_CODE_RE, (m, body) => {
    codes.push(`<code>${body}</code>`);
    return `${CODE_PLACEHOLDER}${codes.length - 1}${CODE_PLACEHOLDER}`;
  });
  const withBoldLinks = protectedText
    .replace(BOLD_RE, '<strong>$1</strong>')
    .replace(IMAGE_RE, '<span class="doc-img">[image: $1]</span>')
    .replace(LINK_RE, '<a href="$2">$1</a>');
  return withBoldLinks.replace(
    new RegExp(`${CODE_PLACEHOLDER}(\\d+)${CODE_PLACEHOLDER}`, 'g'),
    (m, i) => codes[Number(i)] ?? m,
  );
};

/** A `| a | b |` table row → its trimmed cells (drops the leading/trailing |). */
const splitRow = (line) =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

/** True when every cell is a `---` (or `:---:`) separator cell. */
const isSeparatorRow = (line) => {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
};

/** A fenced ```text … ``` block → <pre><code> (whitespace preserved verbatim). */
const FENCE_RE = /^```/;

/**
 * Render a markdown string to an HTML fragment using the documented subset.
 * Blocks are processed line-by-line; blank lines separate paragraphs. Any
 * construct outside the subset is rendered as plain escaped text (never
 * dropped, never interpreted) so a doc edit can't silently vanish a row.
 *
 * @param {string} md
 * @returns {string} HTML fragment (no <html>/<body> wrapper).
 */
export const renderMarkdown = (md) => {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block (the ASCII diagrams). Consumed verbatim, closed by the
    // next fence line; an unterminated fence still emits its content.
    if (FENCE_RE.test(line)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // consume the closing fence (or run off the end)
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // ATX headings: # → h1 … ###### → h6.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
      i += 1;
      continue;
    }

    // Pipe table: a row starting with | that is not a separator. Collect all
    // consecutive table rows; the first separator row (if any) marks the end
    // of the header and the start of the body.
    if (line.trim().startsWith('|') && !isSeparatorRow(line)) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i]);
        i += 1;
      }
      const headerIdx = rows.findIndex(isSeparatorRow);
      if (headerIdx > 0) {
        const header = splitRow(rows[0]);
        const body = rows.slice(headerIdx + 1).map(splitRow);
        out.push('<table>');
        out.push(`<thead><tr>${header.map((c) => `<th>${renderInline(escapeHtml(c))}</th>`).join('')}</tr></thead>`);
        out.push(`<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${renderInline(escapeHtml(c))}</td>`).join('')}</tr>`).join('')}</tbody>`);
        out.push('</table>');
      } else {
        // No header row — render as a plain table body.
        out.push(`<table><tbody>${rows.map((r) => `<tr>${splitRow(r).map((c) => `<td>${renderInline(escapeHtml(c))}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      }
      continue;
    }

    // Blockquote: consecutive > lines → one <blockquote>.
    if (line.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${renderInline(escapeHtml(buf.join(' ')))}</blockquote>`);
      continue;
    }

    // Unordered list: consecutive - / * items → one <ul>.
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      out.push(`<ul>${items.map((it) => `<li>${renderInline(escapeHtml(it))}</li>`).join('')}</ul>`);
      continue;
    }

    // Ordered list: consecutive 1. / 2. items → one <ol>.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i += 1;
      }
      out.push(`<ol>${items.map((it) => `<li>${renderInline(escapeHtml(it))}</li>`).join('')}</ol>`);
      continue;
    }

    // Blank line: paragraph boundary.
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Paragraph: gather until a blank line or a construct handled above.
    const buf = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '' || FENCE_RE.test(l) || /^(#{1,6})\s+/.test(l)
        || (l.trim().startsWith('|') && !isSeparatorRow(l)) || l.startsWith('>')
        || /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l)) break;
      buf.push(l);
      i += 1;
    }
    out.push(`<p>${renderInline(escapeHtml(buf.join(' ')))}</p>`);
  }

  return out.join('\n');
};

/**
 * Extract a markdown section bounded by headings: from the FIRST line that
 * starts with `startHeading` up to (not including) the next line that starts
 * with `endHeading`. Returns '' when the start heading is missing, so a
 * renamed section fails loudly in capture-docs.mjs instead of rendering an
 * empty page.
 *
 * @param {string} md
 * @param {string} startHeading  e.g. '## Handoff'
 * @param {string} endHeading    e.g. '## Screenshots'
 */
export const extractSection = (md, startHeading, endHeading) => {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.startsWith(startHeading));
  if (start === -1) return '';
  let end = lines.length;
  if (endHeading) {
    const next = lines.slice(start + 1).findIndex((l) => l.startsWith(endHeading));
    if (next !== -1) end = start + 1 + next;
  }
  return lines.slice(start, end).join('\n');
};
