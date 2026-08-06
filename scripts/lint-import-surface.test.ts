import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditSource, main, scanDir, stripCommentsAndStrings } from './lint-import-surface.mjs';

// ── auditSource: the re-export-of-unused-import rule ─────────────────────────
describe('auditSource · re-export-of-unused-import', () => {
  it('flags a symbol imported only to be re-exported (the nit class)', () => {
    const src = `
      import { InvalidTokenError } from './verify-deployed-hash.mjs';
      export { InvalidTokenError };
    `;
    expect(auditSource(src)).toEqual([
      { kind: 're-export-of-unused-import', symbol: 'InvalidTokenError', module: './verify-deployed-hash.mjs' },
    ]);
  });

  it('passes a re-export WITH a from clause (barrel passthrough)', () => {
    const src = `export { InvalidTokenError } from './verify-deployed-hash.mjs';\n`;
    expect(auditSource(src)).toEqual([]);
  });

  it('passes an import that is genuinely used in the body', () => {
    const src = `
      import { INVALID_TOKEN_MESSAGE } from './verify-deployed-hash.mjs';
      console.error(INVALID_TOKEN_MESSAGE);
    `;
    expect(auditSource(src)).toEqual([]);
  });

  it('flags only the unused symbol when a re-export mixes used and unused imports', () => {
    const src = `
      import { isInvalidToken, InvalidTokenError } from './verify-deployed-hash.mjs';
      export { isInvalidToken, InvalidTokenError };
      export function check(body) { return isInvalidToken(body); }
    `;
    expect(auditSource(src)).toEqual([
      { kind: 're-export-of-unused-import', symbol: 'InvalidTokenError', module: './verify-deployed-hash.mjs' },
    ]);
  });

  it('names the ORIGINAL symbol when the re-export uses an alias', () => {
    const src = `
      import { InvalidTokenError } from './verify-deployed-hash.mjs';
      export { InvalidTokenError as TokenError };
    `;
    expect(auditSource(src)).toEqual([
      { kind: 're-export-of-unused-import', symbol: 'InvalidTokenError', module: './verify-deployed-hash.mjs' },
    ]);
  });

  it('does not count a bare mention inside a comment or string as a use', () => {
    const mentionedOnlyInComment = `
      import { InvalidTokenError } from './verify-deployed-hash.mjs';
      // InvalidTokenError is documented here but never constructed.
      export { InvalidTokenError };
    `;
    expect(auditSource(mentionedOnlyInComment)).toEqual([
      { kind: 're-export-of-unused-import', symbol: 'InvalidTokenError', module: './verify-deployed-hash.mjs' },
    ]);

    const mentionedOnlyInString = `
      import { unusedThing } from './verify-deployed-hash.mjs';
      console.log('unusedThing appears only inside this string');
    `;
    expect(auditSource(mentionedOnlyInString)).toEqual([
      { kind: 'unused-import', symbol: 'unusedThing', module: './verify-deployed-hash.mjs' },
    ]);
  });

  it('treats a comment that only mentions a used symbol as a real use (no false positive)', () => {
    const src = `
      // The unit test imports readFileSync from node:fs to read fixtures.
      import { readFileSync } from 'node:fs';
      console.log('no real usage');
    `;
    // The doc comment mentions readFileSync, but the import itself is unused.
    expect(auditSource(src)).toEqual([
      { kind: 'unused-import', symbol: 'readFileSync', module: 'node:fs' },
    ]);
  });
});

// ── auditSource: the plain unused-import rule ────────────────────────────────
describe('auditSource · unused-import', () => {
  it('flags an imported symbol that is never referenced', () => {
    const src = `
      import { readFileSync } from 'node:fs';
      console.log('hello');
    `;
    expect(auditSource(src)).toEqual([
      { kind: 'unused-import', symbol: 'readFileSync', module: 'node:fs' },
    ]);
  });

  it('respects import aliases when counting uses', () => {
    const used = `
      import { setTimeout as sleep } from 'node:timers/promises';
      await sleep(10);
    `;
    const unused = `
      import { setTimeout as sleep } from 'node:timers/promises';
      console.log('no timer');
    `;
    expect(auditSource(used)).toEqual([]);
    expect(auditSource(unused)).toEqual([
      { kind: 'unused-import', symbol: 'sleep', module: 'node:timers/promises' },
    ]);
  });

  it('handles default and namespace imports', () => {
    const src = `
      import path from 'node:path';
      import * as fs from 'node:fs';
      console.log(path.sep, fs.readFileSync);
    `;
    expect(auditSource(src)).toEqual([]);
  });

  it('does not count the symbol inside its own import block as a use', () => {
    const src = `
      import { alpha } from './a.mjs';
      import { beta } from './b.mjs';
      console.log(beta);
    `;
    expect(auditSource(src)).toEqual([
      { kind: 'unused-import', symbol: 'alpha', module: './a.mjs' },
    ]);
  });
});

// ── stripCommentsAndStrings ──────────────────────────────────────────────────
describe('stripCommentsAndStrings', () => {
  it('removes line and block comments and quoted strings', () => {
    const src = `import { a } from './m'; // keep a
      /* block with b */
      const s = "keep c";
      const t = 'keep d';
      a;`;
    const stripped = stripCommentsAndStrings(src);
    expect(stripped).not.toContain('keep a');
    expect(stripped).not.toContain('block with b');
    expect(stripped).not.toContain('keep c');
    expect(stripped).not.toContain('keep d');
    expect(stripped).toContain('a;');
  });
});

// ── main: the CLI exit-code contract ─────────────────────────────────────────
describe('main (CLI exit-code contract)', () => {
  it('returns 1 when the scanned dir contains a violating file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-import-surface-cli-'));
    try {
      writeFileSync(
        join(dir, 'verify-bad.mjs'),
        `import { X } from './verify-deployed-hash.mjs';\nexport { X };\n`,
      );
      expect(main(['node', 'scripts/lint-import-surface.mjs'], dir)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns 0 when the scanned dir is clean', () => {
    expect(main(['node', 'scripts/lint-import-surface.mjs'])).toBe(0);
  });
});

// ── scanDir: the real working tree must stay clean ───────────────────────────
describe('scanDir (live repo)', () => {
  it('finds no re-export or unused-import violations across the verify suite', () => {
    const findings = scanDir();
    expect(findings).toEqual([]);
  });

  it('reports findings with the owning file attached when present', () => {
    // Plant a temporary violating file in a temp dir and scan that dir.
    const dir = mkdtempSync(join(tmpdir(), 'lint-import-surface-'));
    try {
      writeFileSync(
        join(dir, 'verify-bad.mjs'),
        `import { X } from './verify-deployed-hash.mjs';\nexport { X };\n`,
      );
      const findings = scanDir(dir);
      expect(findings).toEqual([
        { file: 'verify-bad.mjs', kind: 're-export-of-unused-import', symbol: 'X', module: './verify-deployed-hash.mjs' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
