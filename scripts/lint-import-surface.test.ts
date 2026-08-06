import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { auditSource, main, scanDir, scanRoots } from './lint-import-surface.mjs';

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

  it('does not count template-literal TEXT as a use (only interpolations are real)', () => {
    const src = `
      import { unusedThing } from './verify-deployed-hash.mjs';
      const message = \`the unusedThing symbol is just text here\`;
      console.log(message);
    `;
    expect(auditSource(src)).toEqual([
      { kind: 'unused-import', symbol: 'unusedThing', module: './verify-deployed-hash.mjs' },
    ]);
  });

  it('does not count an object-literal KEY as a use ({ X: 1 })', () => {
    const src = `
      import { X } from './mod';
      const o = { X: 1 };
      console.log(o);
    `;
    expect(auditSource(src)).toEqual([{ kind: 'unused-import', symbol: 'X', module: './mod' }]);
  });

  it('does not count a property-access NAME as a use (obj.X)', () => {
    const src = `
      import { X } from './mod';
      console.log(instance.X);
    `;
    expect(auditSource(src)).toEqual([{ kind: 'unused-import', symbol: 'X', module: './mod' }]);
  });

  it('counts a shorthand property as a genuine use ({ X })', () => {
    const src = `
      import { X } from './mod';
      const o = { X };
      console.log(o);
    `;
    expect(auditSource(src)).toEqual([]);
  });

  it('counts a computed object key as a genuine use ({ [X]: 1 })', () => {
    const src = `
      import { X } from './mod';
      const o = { [X]: 1 };
      console.log(o);
    `;
    expect(auditSource(src)).toEqual([]);
  });

  it('does not count an object-literal method key as a use ({ X() {} })', () => {
    const src = `
      import { X } from './mod';
      const o = { X() { return 1; } };
      console.log(o);
    `;
    expect(auditSource(src)).toEqual([{ kind: 'unused-import', symbol: 'X', module: './mod' }]);
  });

  it('does not count an interface member name as a use (interface A { X })', () => {
    const src = `
      import { X } from './mod';
      interface A { X: string }
      console.log(A);
    `;
    expect(auditSource(src)).toEqual([{ kind: 'unused-import', symbol: 'X', module: './mod' }]);
  });

  it('does not count an enum member name as a use (enum E { X })', () => {
    const src = `
      import { X } from './mod';
      enum E { X }
      console.log(E);
    `;
    expect(auditSource(src)).toEqual([{ kind: 'unused-import', symbol: 'X', module: './mod' }]);
  });

  it('does not count a property-access name in assignment-target position (obj.X = 5)', () => {
    const src = `
      import { X } from './mod';
      instance.X = 5;
    `;
    expect(auditSource(src)).toEqual([{ kind: 'unused-import', symbol: 'X', module: './mod' }]);
  });

  it('does not count a property-access name under optional chaining (obj?.X)', () => {
    const src = `
      import { X } from './mod';
      console.log(instance?.X);
    `;
    expect(auditSource(src)).toEqual([{ kind: 'unused-import', symbol: 'X', module: './mod' }]);
  });

  it('counts the LEFT side of a type qualified name as a use but not the right (Foo.Bar)', () => {
    const usedLeft = `
      import { Foo } from './ns';
      type T = Foo.Bar;
      console.log(T);
    `;
    expect(auditSource(usedLeft)).toEqual([]);

    const unusedRight = `
      import { Bar } from './ns';
      interface A { b: Foo.Bar }
      console.log(A);
    `;
    expect(auditSource(unusedRight)).toEqual([
      { kind: 'unused-import', symbol: 'Bar', module: './ns' },
    ]);
  });

  it('counts an identifier inside a template interpolation as a real use (engine.ts regression)', () => {
    // This is the exact case that broke the old regex stripper: an apostrophe
    // inside a template literal used to open a false string match that
    // swallowed the modelLabel usage until the next quote.
    const src = `
      import { modelLabel } from './labels';
      const line = \`Chef's pick: \${modelLabel(e.model)} (overall **\${e.overallScore}/10**)\`;
      console.log(line);
    `;
    expect(auditSource(src)).toEqual([]);
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

  it('recognizes type-position uses of a type-only import', () => {
    const src = `
      import type { Project } from '@/types';
      const p: Project = { name: 'x' };
      console.log(p);
    `;
    expect(auditSource(src)).toEqual([]);
  });

  it('parses .tsx files and counts JSX element uses (script-kind branch)', () => {
    const src = `
      import { Foo } from './foo';
      import { Bar } from './bar';
      export const el = <Foo />;
    `;
    expect(auditSource(src, 'component.tsx')).toEqual([
      { kind: 'unused-import', symbol: 'Bar', module: './bar' },
    ]);
  });
});

// ── scanDir / scanRoots: the real working tree must stay clean ───────────────
describe('scanRoots (live repo)', () => {
  it('finds no re-export or unused-import violations across scripts/, lib/, and app/', () => {
    const findings = scanRoots();
    expect(findings).toEqual([]);
  });
});

// The live-clean-scan test above would silently PASS if app/ ever stopped
// being scanned: an empty result is indistinguishable from "no violations" vs
// "not scanning the tree". This planted test closes that blind spot.
//
// It MUST plant the violation inside the REAL app/ directory and call
// scanRoots with the literal 'app' root: scanRoots resolves each root against
// REPO_ROOT (process.cwd(), captured at module load), so a temp dir elsewhere
// would never be scanned by scanRoots(['app']) — a "temp app-like tree"
// version of this test would silently lock nothing. The file is removed in
// finally, and an afterAll self-heals any hard-kill leftover, so the tree is
// never left dirty.
describe('scanRoots (planted violation locks the app root)', () => {
  const plantedPath = join(process.cwd(), 'app', '__linttest-planted.mjs');

  afterAll(() => {
    rmSync(plantedPath, { force: true });
  });

  it('catches a planted violation under app/ via both the default roots and the explicit app root', () => {
    writeFileSync(
      plantedPath,
      `import { X } from './verify-deployed-hash.mjs';\nexport { X };\n`,
    );
    try {
      const plantedFinding = {
        file: relative(process.cwd(), plantedPath),
        kind: 're-export-of-unused-import',
        symbol: 'X',
        module: './verify-deployed-hash.mjs',
      };
      // Default roots: proves app/ is still a member of DEFAULT_ROOTS. If it
      // were dropped, this returns [] and the test fails instead of silently
      // passing like the live-clean-scan would.
      expect(scanRoots()).toContainEqual(plantedFinding);
      // Explicit third root: proves the app/ tree itself is scanned. The
      // exact file path in the finding attributes it to the app root.
      expect(scanRoots(['app'])).toContainEqual(plantedFinding);
    } finally {
      rmSync(plantedPath, { force: true });
    }
  });
});

describe('scanDir (planted violations)', () => {
  it('reports findings with the owning file attached when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-import-surface-'));
    try {
      writeFileSync(
        join(dir, 'verify-bad.mjs'),
        `import { X } from './verify-deployed-hash.mjs';\nexport { X };\n`,
      );
      const findings = scanDir(dir);
      expect(findings).toEqual([
        { file: relative(process.cwd(), join(dir, 'verify-bad.mjs')), kind: 're-export-of-unused-import', symbol: 'X', module: './verify-deployed-hash.mjs' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scans recursively into subdirectories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-import-surface-sub-'));
    try {
      writeFileSync(
        join(dir, 'verify-bad.mjs'),
        `import { Y } from './verify-deployed-hash.mjs';\nexport { Y };\n`,
      );
      const findings = scanDir(dir);
      expect(findings).toHaveLength(1);
      expect(findings[0].kind).toBe('re-export-of-unused-import');
      expect(findings[0].symbol).toBe('Y');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── main: the CLI exit-code contract ─────────────────────────────────────────
describe('main (CLI exit-code contract)', () => {
  it('returns 1 when the scanned roots contain a violating file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-import-surface-cli-'));
    try {
      writeFileSync(
        join(dir, 'verify-bad.mjs'),
        `import { X } from './verify-deployed-hash.mjs';\nexport { X };\n`,
      );
      expect(main([dir])).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns 0 when the scanned roots are clean', () => {
    expect(main()).toBe(0);
  });

  it('returns 1 with a clear message when a root is missing (wrong cwd guard)', () => {
    expect(main(['definitely-not-a-real-root'])).toBe(1);
  });
});
