import { describe, expect, it } from 'vitest';

import {
  briefingPrintMeta,
  buildPreviewHtml,
  escapeHtml,
  printHtmlFileName,
  printPdfFileName,
  printTitleSlug,
  PrintDocSchema,
  reportPrintMeta,
  type PrintDoc,
} from './printDoc';

const doc: PrintDoc = {
  title: 'Daily <Report>',
  meta: '2 attention items',
  callouts: [
    { heading: 'AI "summary"', label: 'DeepSeek Chat', text: 'Push <main> & ship.' },
  ],
  body: '# Body\n## Section & more',
};

describe('PrintDocSchema', () => {
  it('accepts a valid document', () => {
    expect(PrintDocSchema.safeParse(doc).success).toBe(true);
  });

  it('accepts a list-only document', () => {
    const listDoc: PrintDoc = {
      title: "Today's Top Three",
      list: [{ number: 1, title: 'Ship onboarding', project: 'Meal Planner', detail: 'rank 3' }],
    };
    expect(PrintDocSchema.safeParse(listDoc).success).toBe(true);
  });

  it('rejects a missing title', () => {
    expect(PrintDocSchema.safeParse({ body: '# x' }).success).toBe(false);
  });

  it('rejects a non-string body and an over-long title', () => {
    expect(PrintDocSchema.safeParse({ title: 42 }).success).toBe(false);
    expect(PrintDocSchema.safeParse({ title: 'x'.repeat(301) }).success).toBe(false);
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML metacharacters', () => {
    expect(escapeHtml(`a & b < c > d " e ' f`)).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &#39; f',
    );
  });

  it('coerces nullish values to an empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('shared meta builders', () => {
  it('reportPrintMeta renders kind · attention count · optional age', () => {
    expect(reportPrintMeta({ kind: 'daily', attentionCount: 3 })).toBe('daily report · 3 attention items');
    expect(reportPrintMeta({ kind: 'weekly', attentionCount: 1, ageLabel: '2h ago' })).toBe('weekly report · 1 attention items · 2h ago');
  });

  it('briefingPrintMeta pluralizes by action count', () => {
    expect(briefingPrintMeta(1)).toBe('1 priority action');
    expect(briefingPrintMeta(3)).toBe('3 priority actions');
  });
});

describe('printTitleSlug', () => {
  it('slugifies the title into a safe filename stem', () => {
    expect(printTitleSlug({ title: 'Daily Command Center Report — 8/4/2026' })).toBe('daily-command-center-report-8-4-2026');
    expect(printTitleSlug({ title: "Today's Top Three" })).toBe('today-s-top-three');
  });

  it('returns an empty stem when the title has no safe characters', () => {
    expect(printTitleSlug({ title: '!!! ***' })).toBe('');
  });
});

describe('printPdfFileName', () => {
  it('slugifies the title into a safe .pdf filename', () => {
    expect(printPdfFileName({ title: 'Daily Command Center Report — 8/4/2026' })).toBe('daily-command-center-report-8-4-2026.pdf');
    expect(printPdfFileName({ title: "Today's Top Three" })).toBe('today-s-top-three.pdf');
  });

  it('falls back to print.pdf when the title has no safe characters', () => {
    expect(printPdfFileName({ title: '!!! ***' })).toBe('print.pdf');
  });
});

describe('printHtmlFileName', () => {
  it('shares the SAME slug stem as the PDF name with a .html extension', () => {
    const title = { title: 'Daily Command Center Report — 8/4/2026' };
    expect(printHtmlFileName(title)).toBe('daily-command-center-report-8-4-2026.html');
    // The stem is identical to the PDF filename's stem — the two export
    // formats can never drift apart for the same document.
    expect(printHtmlFileName(title).replace(/\.html$/, '')).toBe(printPdfFileName(title).replace(/\.pdf$/, ''));
  });

  it('falls back to print.html when the title has no safe characters', () => {
    expect(printHtmlFileName({ title: '!!! ***' })).toBe('print.html');
  });
});

describe('buildPreviewHtml', () => {
  it('renders the toolbar and paper layout with escaped content', () => {
    const html = buildPreviewHtml(doc);
    // Toolbar with a Print + Close button and the title in the <title>.
    expect(html).toContain('<title>Daily &lt;Report&gt;</title>');
    expect(html).toContain('class="btn-print"');
    expect(html).toContain('onclick="window.print()"');
    expect(html).toContain('onclick="window.close()"');
    // Paper: h1 title, meta, callout with heading/label/text — all escaped.
    expect(html).toContain('<h1>Daily &lt;Report&gt;</h1>');
    expect(html).toContain('<p class="meta">2 attention items</p>');
    expect(html).toContain('AI &quot;summary&quot;');
    expect(html).toContain('(DeepSeek Chat)');
    expect(html).toContain('Push &lt;main&gt; &amp; ship.');
    // Monospace body in a <pre>, escaped.
    expect(html).toContain('<pre># Body\n## Section &amp; more</pre>');
  });

  it('renders a numbered list instead of a body when list is provided', () => {
    const listDoc: PrintDoc = {
      title: "Today's Top Three",
      list: [
        { number: 1, title: 'Ship <onboarding>', project: 'Meal Planner', detail: 'Overdue (rank 3)' },
        { number: 2, title: 'Push main' },
      ],
    };
    const html = buildPreviewHtml(listDoc);
    expect(html).toContain('<ol>');
    expect(html).toContain('1. Ship &lt;onboarding&gt;');
    expect(html).toContain('· Meal Planner');
    expect(html).toContain('Overdue (rank 3)');
    expect(html).toContain('2. Push main');
    // No body pre when the list path is used.
    expect(html).not.toContain('<pre>');
  });

  it('omits meta, callouts, body, and list when absent', () => {
    const html = buildPreviewHtml({ title: 'Bare' });
    expect(html).toContain('<h1>Bare</h1>');
    expect(html).not.toContain('class="meta"');
    expect(html).not.toContain('class="callout"');
    expect(html).not.toContain('<pre>');
    expect(html).not.toContain('<ol>');
  });

  it('renders only the body when both body and list are supplied (mutual exclusion)', () => {
    // The PrintDoc contract says body and list are mutually exclusive; when a
    // caller breaks the contract, body wins so the paper never shows two
    // content blocks for one document.
    const html = buildPreviewHtml({ title: 'Both', body: '# body', list: [{ number: 1, title: 'item' }] });
    expect(html).toContain('<pre># body</pre>');
    expect(html).not.toContain('<ol>');
  });
});
