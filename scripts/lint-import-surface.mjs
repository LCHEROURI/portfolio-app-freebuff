#!/usr/bin/env node
// ============================================================================
// scripts/lint-import-surface.mjs — static import-surface lint for the verify
// suite.
//
// The /check review of the token-health work flagged a real drift risk: a
// module imported a symbol (InvalidTokenError) only to re-export it for the
// unit test, so the import surface implied the script used a class it never
// constructed. This linter makes that class of regression fail loudly:
//
//   1. re-export-of-unused-import — `export { X }` where X is imported in the
//      same file and never used anywhere else. The fix is to import X from its
//      source module directly (in the test) instead of re-exporting it.
//   2. unused-import — a plain imported symbol with zero uses outside the
//      import block.
//
// Barrels (`export { X } from './mod'`) are deliberately allowed: a re-export
// WITH a `from` clause is the passthrough pattern and cannot be an imported
// symbol the module never uses.
//
// Scans scripts/verify-*.mjs and scripts/verify-*.test.ts. Exits 1 with the
// offending symbols when any finding exists; prints a clean message and exits
// 0 otherwise.
//
// Usage:
//   node scripts/lint-import-surface.mjs
//   npm run lint                       # runs next lint, then this
//
// Exports (for the unit test): auditSource, scanDir, stripCommentsAndStrings,
// main.
// Read-only against the working tree.
// ============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve from the repo root (cwd) like the other verify scripts do, so the
// module also loads cleanly under vitest's transform (import.meta.url is not
// a file URL there).
const SCRIPTS_DIR = resolve(process.cwd(), 'scripts');

const NAMED_IMPORT_RE = /import\s*(?:type\s*)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
const DEFAULT_IMPORT_RE = /import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g;
const STAR_IMPORT_RE = /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g;
const RE_EXPORT_RE = /export\s*\{([\s\S]*?)\}(?:\s*from\s*['"]([^'"]+)['"])?/g;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Produce a copy of the source with // and /* *\/ comments and
 * single/double-quoted string literals blanked to spaces of EQUAL length, so
 * doc comments or prose that merely mentions a symbol can't create phantom
 * imports or mask a genuinely dead one, while every character index stays
 * aligned with the original source (the import/re-export block ranges are
 * computed against the original and must line up with this counting text).
 * Template literals are intentionally left as-is: the few backtick strings in
 * the verify suite are short messages, and a stripped template could hide a
 * real identifier.
 */
export function stripCommentsAndStrings(source) {
  return source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|(['"])(?:\\.|(?!\1)[^\\])*?\1/g, (m) => ' '.repeat(m.length));
}

/**
 * Audit one file's source for import-surface findings.
 * Returns an array of { kind, symbol, module } — empty when clean.
 */
export function auditSource(source) {
  const findings = [];
  const imports = [];
  const blocks = []; // source ranges to exclude when counting uses
  const code = stripCommentsAndStrings(source);

  for (const m of source.matchAll(NAMED_IMPORT_RE)) {
    blocks.push({ start: m.index, end: m.index + m[0].length });
    const module = m[2];
    for (const part of m[1].split(',')) {
      const p = part.trim();
      if (!p) continue;
      const [name, alias] = p.split(/\s+as\s+/);
      imports.push({ binding: (alias || name).trim(), module });
    }
  }
  for (const m of source.matchAll(DEFAULT_IMPORT_RE)) {
    blocks.push({ start: m.index, end: m.index + m[0].length });
    imports.push({ binding: m[1], module: m[2] });
  }
  for (const m of source.matchAll(STAR_IMPORT_RE)) {
    blocks.push({ start: m.index, end: m.index + m[0].length });
    imports.push({ binding: m[1], module: m[2] });
  }

  const reExported = new Set();
  for (const m of source.matchAll(RE_EXPORT_RE)) {
    blocks.push({ start: m.index, end: m.index + m[0].length });
    // Re-export WITH a from clause is a passthrough barrel — allowed.
    if (m[2]) continue;
    for (const part of m[1].split(',')) {
      const name = part.trim();
      if (!name) continue;
      // Track the ORIGINAL name, not the alias: `export { X as Y }` re-exports
      // the imported X, so the finding must name X.
      reExported.add(name.split(/\s+as\s+/)[0].trim());
    }
  }

  const countOutside = (binding) => {
    const re = new RegExp(`\\b${escapeRegExp(binding)}\\b`, 'g');
    let count = 0;
    for (const m of code.matchAll(re)) {
      if (!blocks.some((b) => m.index >= b.start && m.index < b.end)) count++;
    }
    return count;
  };

  for (const imp of imports) {
    if (countOutside(imp.binding) > 0) continue;
    if (reExported.has(imp.binding)) {
      findings.push({ kind: 're-export-of-unused-import', symbol: imp.binding, module: imp.module });
    } else {
      findings.push({ kind: 'unused-import', symbol: imp.binding, module: imp.module });
    }
  }

  return findings;
}

/**
 * Scan the scripts/ dir's verify suite (scripts/verify-*.mjs plus the
 * verify test files) for import-surface findings. Returns findings with the
 * owning file attached, in deterministic file order.
 */
export function scanDir(dir = SCRIPTS_DIR) {
  const findings = [];
  const files = readdirSync(dir)
    .filter((f) => /^verify-.*\.mjs$/.test(f) || /^verify-.*\.test\.ts$/.test(f))
    .sort();
  for (const f of files) {
    const source = readFileSync(resolve(dir, f), 'utf8');
    for (const finding of auditSource(source)) {
      findings.push({ file: f, ...finding });
    }
  }
  return findings;
}

export function main(argv = process.argv, dir = SCRIPTS_DIR) {
  const findings = scanDir(dir);
  if (findings.length === 0) {
    console.log('lint-import-surface: clean — no re-export-of-unused-import or unused-import findings.');
    return 0;
  }
  console.error('lint-import-surface: FAIL');
  for (const f of findings) {
    console.error(`  ${f.file}: ${f.kind} — ${f.symbol} imported from ${f.module}`);
  }
  console.error('Import the symbol directly from its source module (in the test) instead of re-exporting it, or remove the unused import.');
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv, SCRIPTS_DIR);
}
