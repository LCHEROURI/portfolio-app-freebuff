import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { extractSection, renderInline, renderMarkdown } from './markdown-html.mjs';

describe('renderInline (escaped input)', () => {
  it('renders inline code, bold, and links', () => {
    const html = renderInline('run `npm run verify:all` and **bold** and [a link](https://x.dev)');
    expect(html).toContain('<code>npm run verify:all</code>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="https://x.dev">a link</a>');
  });

  it('leaves plain text untouched', () => {
    expect(renderInline('just words — em dash ✓')).toBe('just words — em dash ✓');
  });

  it('keeps code spans atomic — bold/links cannot corrupt a span containing them', () => {
    // A code span containing ** or [ ] must stay one <code> element; the bold
    // and link patterns run on placeholders and can never reach inside.
    expect(renderInline('`**not bold**` and `[not a link]`')).toBe(
      '<code>**not bold**</code> and <code>[not a link]</code>',
    );
  });

  it('still applies bold inside a link and code inside bold', () => {
    // Placeholders round-trip through the later patterns, not just around them.
    expect(renderInline('**[bold link](https://x.dev)**')).toBe(
      '<strong><a href="https://x.dev">bold link</a></strong>',
    );
    expect(renderInline('**run `npm run x`**')).toBe(
      '<strong>run <code>npm run x</code></strong>',
    );
  });

  it('renders image references as a clean span, not a stray ! + link', () => {
    // The capture renders into a data: URL page where a relative src cannot
    // resolve, and inlining bytes would compound across regenerations — so an
    // image reference becomes the alt text as a styled span with an [image:]
    // prefix, and the leading `!` must not leak out or turn the path into a
    // clickable link.
    expect(renderInline('![README Handoff](screenshots/docs-handoff.png)')).toBe(
      '<span class="doc-img">[image: README Handoff]</span>',
    );
    expect(renderInline('plain ![alt](x.png) text')).toBe(
      'plain <span class="doc-img">[image: alt]</span> text',
    );
  });

  it('keeps image syntax inside code spans atomic', () => {
    // A code span containing ![ ]( ) must stay one <code> element; the image
    // pattern runs on placeholders and can never reach inside.
    expect(renderInline('`![not an image](x.png)`')).toBe(
      '<code>![not an image](x.png)</code>',
    );
  });
});

describe('renderMarkdown (block constructs)', () => {
  it('renders ATX headings with the right levels', () => {
    const html = renderMarkdown('# One\n\n## Two\n\n### Three');
    expect(html).toContain('<h1>One</h1>');
    expect(html).toContain('<h2>Two</h2>');
    expect(html).toContain('<h3>Three</h3>');
  });

  it('renders paragraphs separated by blank lines', () => {
    const html = renderMarkdown('first para\n\nsecond para');
    expect(html).toContain('<p>first para</p>');
    expect(html).toContain('<p>second para</p>');
  });

  it('preserves fenced ASCII diagrams verbatim inside pre/code', () => {
    const md = ['```text', '   ┌────────┐', '   │  BOX   │', '   └────────┘', '```'].join('\n');
    const html = renderMarkdown(md);
    expect(html).toContain('<pre><code>');
    expect(html).toContain('   ┌────────┐\n   │  BOX   │\n   └────────┘');
    expect(html).toContain('</code></pre>');
  });

  it('emits an unterminated fence body rather than dropping it', () => {
    const html = renderMarkdown('```text\nstill here');
    expect(html).toContain('still here');
  });

  it('renders a pipe table with a header separator row', () => {
    const md = [
      '| Gate | Requires |',
      '| --- | --- |',
      '| `npm run verify:x` | `TOKEN` |',
      '| `node scripts/y.mjs` | — |',
    ].join('\n');
    const html = renderMarkdown(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<thead><tr><th>Gate</th><th>Requires</th></tr></thead>');
    expect(html).toContain('<td><code>npm run verify:x</code></td>');
    expect(html).toContain('<td><code>node scripts/y.mjs</code></td>');
    // The table is emitted with newline-separated block tags, so assert the
    // closing tags independently rather than as one contiguous string.
    expect(html).toContain('</tbody>');
    expect(html).toContain('</table>');
  });

  it('renders blockquotes, unordered lists, and ordered lists', () => {
    const md = [
      '> a note',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '2. second',
    ].join('\n');
    const html = renderMarkdown(md);
    expect(html).toContain('<blockquote>a note</blockquote>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<ol><li>first</li><li>second</li></ol>');
  });

  it('escapes raw HTML instead of passing it through', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('extractSection', () => {
  const md = [
    '## Handoff',
    'architecture',
    '### sub',
    '## Screenshots',
    'images',
    '## Stack',
  ].join('\n');

  it('extracts from the start heading up to the next end heading', () => {
    const section = extractSection(md, '## Handoff', '## Screenshots');
    expect(section).toContain('architecture');
    expect(section).toContain('### sub');
    expect(section).not.toContain('images');
  });

  it("returns '' when the start heading is missing", () => {
    expect(extractSection(md, '## Nope', '## Screenshots')).toBe('');
  });

  it('runs to the end of the doc when the end heading is absent', () => {
    const section = extractSection(md, '## Screenshots', '## Missing');
    expect(section).toContain('images');
  });

  it('extracts the real README Handoff section from the live file', () => {
    const readme = readFileSync('README.md', 'utf8');
    const section = extractSection(readme, '## Handoff', '## Screenshots');
    expect(section).toContain('## Handoff — read this first');
    expect(section).toContain('### The 17 verification gates');
    expect(section).toContain('When each gate runs:');
    // Both docs-PNG embeds must stay inside the Handoff section (before the
    // Screenshots section) — a future edit dropping either embed fails here.
    expect(section).toContain('screenshots/docs-handoff.png');
    expect(section).toContain('screenshots/docs-launch-gates.png');
    expect(section).not.toContain('## Screenshots');
  });

  it('extracts the real launch.md §4 section from the live file', () => {
    const launch = readFileSync('docs/launch.md', 'utf8');
    const section = extractSection(launch, '## 4. The verification gates', '## 5.');
    expect(section).toContain('## 4. The verification gates');
    expect(section).toContain('npm run verify:token-health');
    expect(section).toContain('When each gate runs');
    expect(section).not.toContain('## 5. Go-live checklist');
  });
});
