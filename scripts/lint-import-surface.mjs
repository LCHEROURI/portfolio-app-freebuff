#!/usr/bin/env node
// ============================================================================
// scripts/lint-import-surface.mjs — static import-surface lint for the repo's
// scripts/ and lib/ trees.
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
// Parsing is delegated to the TypeScript compiler API (a devDependency), not a
// hand-rolled regex pass: strings, comments, and template text are distinct
// token kinds, so a doc comment that merely mentions a symbol can't create a
// phantom import, and a real identifier inside a template interpolation
// (`${modelLabel(x)}`) counts as a genuine use. A regex stripper cannot do
// this reliably (an apostrophe inside a template literal opened a false string
// match that swallowed real code in lib/engine.ts).
//
// Identifier-use semantics: a binding REFERENCE is a use. Property/selector
// positions are names, not references, and are excluded from the use set: the
// name of a property access (obj.X), a type qualified name (Foo.Bar),
// object-literal keys ({ X: 1 }), method keys ({ X() {} }), class member,
// interface member, and enum member names. Computed keys ({ [X]: 1 }) and
// shorthand properties ({ X }) ARE genuine uses, as are template
// interpolations. Runs from the repo root only:
// scanRoots hard-fails if a root is absent, so a wrong cwd can never silently
// report a clean scan.
//
// Scans scripts/, lib/, and app/ recursively (.mjs / .ts / .tsx). Exits 1
// with the offending symbols when any finding exists; prints a clean message
// and exits 0 otherwise.
//
// Usage:
//   node scripts/lint-import-surface.mjs
//   npm run lint                       # runs next lint, then this
//
// Exports (for the unit test): auditSource, scanDir, scanRoots, main.
// Read-only against the working tree.
// ============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = process.cwd();
const DEFAULT_ROOTS = ['scripts', 'lib', 'app'];
const SOURCE_EXT = /\.(mjs|js|ts|tsx)$/;

const scriptKindFor = (fileName) => {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.mjs') || fileName.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};

/**
 * Audit one file's source for import-surface findings.
 * Returns an array of { kind, symbol, module } — empty when clean.
 */
export function auditSource(source, fileName = 'file.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
  const findings = [];
  const imports = []; // { binding, module }
  const reExported = new Set(); // original names locally re-exported (no `from`)
  const usedOutside = new Set(); // identifier uses outside import/export decls

  // Single AST walk. Import/export declarations are fully consumed here (their
  // children are only the clause/specifier we already read), so we do not
  // recurse into them — that keeps their identifiers out of the use set, which
  // is exactly the semantics we want (a re-export is not a use). Everything
  // else is an identifier use. The compiler's own tokenizer keeps string
  // contents and template TEXT out of the identifier stream while still
  // surfacing `${expr}` interpolations.
  // Node kinds whose `name` is a property/selector NAME (not a binding
  // reference): object-literal keys and methods ({ X: 1 }, { X() {} }), class
  // members and accessors, interface members, and enum member names. The name
  // is visited only when it is COMPUTED ([X] evaluates X and is a real use);
  // otherwise it is skipped.
  const NAMED_MEMBER_KINDS = [
    ts.isPropertyAssignment,
    ts.isMethodDeclaration,
    ts.isGetAccessorDeclaration,
    ts.isSetAccessorDeclaration,
    ts.isPropertyDeclaration,
    ts.isPropertySignature,
    ts.isMethodSignature,
    ts.isEnumMember,
  ];

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const moduleText =
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '';
      const clause = node.importClause;
      if (clause) {
        if (clause.name) imports.push({ binding: clause.name.text, module: moduleText }); // default import
        const nb = clause.namedBindings;
        if (nb) {
          if (ts.isNamespaceImport(nb)) {
            imports.push({ binding: nb.name.text, module: moduleText });
          } else {
            for (const el of nb.elements) imports.push({ binding: el.name.text, module: moduleText });
          }
        }
      }
      return;
    }
    if (ts.isExportDeclaration(node)) {
      // Local re-export (no moduleSpecifier) is the nit class. Track the
      // ORIGINAL name: `export { X as Y }` re-exports the imported X, so the
      // finding must name X. Barrels carry a moduleSpecifier and are skipped.
      if (!node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          reExported.add(el.propertyName ? el.propertyName.text : el.name.text);
        }
      }
      return;
    }
    // Property/selector positions are names, not references: the right half of
    // a property access (obj.X) is the member selector — only the expression
    // side (obj) is a use. Same for type qualified names (Foo.Bar → Foo).
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression);
      return;
    }
    if (ts.isQualifiedName(node)) {
      visit(node.left);
      return;
    }
    // Object-literal / class member names ({ X: 1 }, { X() {} }, class A { X })
    // are keys, not binding references. Computed keys ([X]) evaluate X and are
    // real uses; shorthand ({ X }) is a different node kind and falls through
    // to the generic identifier branch below.
    if (NAMED_MEMBER_KINDS.some((isKind) => isKind(node))) {
      if (ts.isComputedPropertyName(node.name)) visit(node.name);
      ts.forEachChild(node, (child) => {
        if (child !== node.name) visit(child);
      });
      return;
    }
    if (ts.isIdentifier(node)) usedOutside.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);

  for (const imp of imports) {
    if (usedOutside.has(imp.binding)) continue;
    if (reExported.has(imp.binding)) {
      findings.push({ kind: 're-export-of-unused-import', symbol: imp.binding, module: imp.module });
    } else {
      findings.push({ kind: 'unused-import', symbol: imp.binding, module: imp.module });
    }
  }

  return findings;
}

/** Recursively list source files under a root, skipping ignored dirs. */
function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue; // unreadable / missing — skip
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const p = resolve(dir, entry);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(p);
      else if (SOURCE_EXT.test(entry)) out.push(p);
    }
  }
  return out.sort();
}

/**
 * Scan one root recursively. Returns findings with the repo-relative file path
 * attached, in deterministic order.
 */
export function scanDir(root) {
  const findings = [];
  for (const file of walkFiles(root)) {
    const rel = relative(REPO_ROOT, file);
    const source = readFileSync(file, 'utf8');
    for (const finding of auditSource(source, rel)) {
      findings.push({ file: rel, ...finding });
    }
  }
  return findings;
}

/**
 * Scan every default root (scripts/, lib/, app/) and merge findings.
 * Hard-fails if a root is missing, so running from the wrong cwd can never
 * silently produce a clean (false) scan.
 */
export function scanRoots(roots = DEFAULT_ROOTS) {
  const findings = [];
  for (const root of roots) {
    const resolved = resolve(REPO_ROOT, root);
    try {
      statSync(resolved);
    } catch {
      throw new Error(`lint-import-surface: root not found: ${resolved} — run from the repo root`);
    }
    findings.push(...scanDir(resolved));
  }
  return findings;
}

export function main(roots = DEFAULT_ROOTS) {
  let findings;
  try {
    findings = scanRoots(roots);
  } catch (err) {
    console.error(err.message);
    return 1;
  }
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
  process.exitCode = main(DEFAULT_ROOTS);
}
