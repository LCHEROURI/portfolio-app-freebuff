import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  CANONICAL_SYSTEM_INJECTED_VARS,
  crossCheckSystemInjectedVars,
  SYSTEM_INJECTED_WORDING_PHRASES,
} from './launch-checklist-gates.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

// ── Real repo live-lock ─────────────────────────────────────────────────────
describe('crossCheckSystemInjectedVars (live repo)', () => {
  const vercelEnvSrc = read('scripts/verify-vercel-env.mjs');
  const launchDoc = read('docs/launch.md');
  const readmeDoc = read('README.md');

  it('passes on the live repo: exemption matches canonical + both docs document it', () => {
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc, launchDoc, readmeDoc });
    expect(failures).toEqual([]);
  });

  it('catches a system-injected var dropped from the set', () => {
    // Remove the VERCEL_OIDC_TOKEN entry — the exact incident that motivated
    // the exemption. The drift guard must fail, not just the unit suite.
    const mutated = vercelEnvSrc.replace(/\n  'VERCEL_OIDC_TOKEN',/, '\n');
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc: mutated, launchDoc, readmeDoc });
    expect(failures.join('\n')).toContain('VERCEL_OIDC_TOKEN');
    expect(failures.join('\n')).toContain('omits canonical');
  });

  it('catches a non-canonical var added to the set', () => {
    const mutated = vercelEnvSrc.replace("  'VERCEL_URL',\n", "  'VERCEL_URL',\n  'VERCEL_NEW_ONE',\n");
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc: mutated, launchDoc, readmeDoc });
    expect(failures.join('\n')).toContain('VERCEL_NEW_ONE');
    expect(failures.join('\n')).toContain('non-canonical');
  });

  it('catches a real project var (VERCEL_TOKEN) exempted in the set', () => {
    // VERCEL_TOKEN shares the prefix but is a genuine project credential in
    // all three stores — exempting it would silently stop comparing it.
    const mutated = vercelEnvSrc.replace("  'VERCEL_URL',\n", "  'VERCEL_URL',\n  'VERCEL_TOKEN',\n");
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc: mutated, launchDoc, readmeDoc });
    expect(failures.join('\n')).toContain('VERCEL_TOKEN');
    expect(failures.join('\n')).toContain('real project var');
  });

  it('catches the §4 vercel-env row losing the exemption note', () => {
    // Renaming the marker in the doc (system-injected → build-injected) must
    // fail — the operational checklist can't silently stop documenting the
    // exemption while the gate still applies it.
    const mutated = launchDoc.replace(/system-injected/gi, 'build-injected');
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc, launchDoc: mutated, readmeDoc });
    expect(failures.join('\n')).toContain('omits the exemption phrase');
    expect(failures.join('\n')).toContain('system-injected');
  });

  it('catches the README handoff vercel-env row losing the exemption note', () => {
    // Same contract on the second onboarding surface — renaming the marker in
    // the README row must fail even though launch.md still documents it.
    const mutated = readmeDoc.replace(/system-injected/gi, 'build-injected');
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc, launchDoc, readmeDoc: mutated });
    expect(failures.join('\n')).toContain('omits the exemption phrase');
    expect(failures.join('\n')).toContain('system-injected');
  });

  it('catches a README row that keeps the marker but softens a phrase', () => {
    // The marker surviving is not enough — softening 'stay value-compared'
    // while keeping 'system-injected' must fail at runtime, not just in the
    // unit suite (this is exactly what the phrase contract adds over the
    // marker check).
    const mutated = readmeDoc.replace('stay value-compared', 'stay compared');
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc, launchDoc, readmeDoc: mutated });
    expect(failures.join('\n')).toContain('stay value-compared');
    expect(failures.join('\n')).toContain('omits the exemption phrase');
  });

  it('SYSTEM_INJECTED_WORDING_PHRASES matches the exemption wording in verify-vercel-env.mjs', () => {
    // The exported phrase list is the doc contract — it must be grounded in
    // the gate source's own vocabulary, so a future refactor that rewords the
    // exemption (e.g. renames system-injected → build-injected) forces the
    // phrase list to update too, keeping the docs aligned with what the gate
    // actually says. Case-insensitive: the source capitalizes "Real project
    // vars" while the docs use lowercase. Comment-prefixed lines are joined
    // with a space, so a phrase wrapped across comment lines (with the
    // trailing // or leading * marker between the words) still matches.
    const src = vercelEnvSrc
      .split('\n')
      .map((line) => line.replace(/^\s*\/\/\s?/, '').replace(/^\s*\*\s?/, '').trim())
      .join(' ')
      .toLowerCase();
    for (const phrase of SYSTEM_INJECTED_WORDING_PHRASES) {
      expect(src, `verify-vercel-env.mjs must carry the exemption phrase: ${phrase}`).toContain(
        phrase.toLowerCase(),
      );
    }
  });

  it('README and launch.md vercel-env rows share the same exemption wording', () => {
    // The two onboarding surfaces must tell the same story: system-injected
    // build vars are exempted, real project vars stay value-compared. Each
    // core phrase must appear in BOTH rows — a doc that softens or drops any
    // part of the contract fails even if the /system-injected/i marker
    // survives. The rows are deliberately not byte-identical (launch.md is
    // the verbose operational row, README the terse onboarding one), so the
    // lock is on the shared semantic phrases, not full-text parity.
    const launchRow = launchDoc.split('\n').find((l) => l.includes('| `npm run verify:vercel-env` |')) ?? '';
    const readmeRow = readmeDoc.split('\n').find((l) => l.startsWith('| vercel-env |')) ?? '';
    expect(launchRow, 'launch.md §4 must have a vercel-env row').not.toBe('');
    expect(readmeRow, 'README must have a vercel-env row').not.toBe('');
    // Iterate the exported source of truth, so the unit test and the drift
    // guard can never disagree about which phrases constitute the contract.
    for (const phrase of SYSTEM_INJECTED_WORDING_PHRASES) {
      expect(launchRow, `launch.md §4 row must carry the phrase: ${phrase}`).toContain(phrase);
      expect(readmeRow, `README row must carry the phrase: ${phrase}`).toContain(phrase);
    }
  });

  it('catches a missing SYSTEM_INJECTED_VARS literal', () => {
    const mutated = vercelEnvSrc.replace(/export const SYSTEM_INJECTED_VARS = new Set\(\[[\s\S]*?\n\]\);\n/, '');
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc: mutated, launchDoc, readmeDoc });
    expect(failures.join('\n')).toContain('no SYSTEM_INJECTED_VARS Set literal');
  });
});

// ── Synthetic fixture: deterministic semantics ──────────────────────────────
describe('crossCheckSystemInjectedVars (fixture)', () => {
  // Build the passing fixture FROM the canonical set, so the green path is
  // guaranteed by construction and every failure case is a single-token edit.
  const canonicalKeys = [...CANONICAL_SYSTEM_INJECTED_VARS];
  const FIXTURE_SRC = `export const SYSTEM_INJECTED_VARS = new Set([\n${canonicalKeys
    .map((k) => `  '${k}',`)
    .join('\n')}\n]);\n`;
  const FIXTURE_DOC = [
    '## 3. The verification gates',
    '| Gate | Requires | What it proves |',
    '| --- | --- | --- |',
    '| `npm run verify:vercel-env` | `VERCEL_TOKEN` | Vercel production env matches `.env.local`. Vercel system-injected build vars (`VERCEL_OIDC_TOKEN`) are exempted from comparison; real project vars (`VERCEL_TOKEN`, `VERCEL_TEAM_ID`) stay value-compared. |',
  ].join('\n');
  // The README table keys rows by bare gate name (no npm run prefix).
  const FIXTURE_README = [
    '### The 15 verification gates',
    '| Gate | Requires | Proves |',
    '| --- | --- | --- |',
    '| vercel-env | `VERCEL_TOKEN` (+ Vercel CLI) | Vercel prod env matches `.env.local` (system-injected build vars like `VERCEL_OIDC_TOKEN` are exempted as informational; real project vars stay value-compared) |',
  ].join('\n');

  it('passes when the set matches the canonical list and BOTH docs document the exemption', () => {
    expect(crossCheckSystemInjectedVars({ vercelEnvSrc: FIXTURE_SRC, launchDoc: FIXTURE_DOC, readmeDoc: FIXTURE_README })).toEqual([]);
  });

  it('flags a non-canonical var in the set', () => {
    const src = FIXTURE_SRC.replace("  'VERCEL_URL',\n", "  'VERCEL_URL',\n  'VERCEL_GHOST',\n");
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc: src, launchDoc: FIXTURE_DOC, readmeDoc: FIXTURE_README });
    expect(failures.join('\n')).toContain('VERCEL_GHOST');
    expect(failures.join('\n')).toContain('non-canonical');
  });

  it('flags a real project var exempted in the set', () => {
    const src = FIXTURE_SRC.replace("  'VERCEL_URL',\n", "  'VERCEL_URL',\n  'VERCEL_TEAM_ID',\n");
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc: src, launchDoc: FIXTURE_DOC, readmeDoc: FIXTURE_README });
    expect(failures.join('\n')).toContain('VERCEL_TEAM_ID');
    expect(failures.join('\n')).toContain('real project var');
  });

  it('fails cleanly when the Set literal is missing entirely', () => {
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc: 'const x = 1;\n', launchDoc: FIXTURE_DOC, readmeDoc: FIXTURE_README });
    expect(failures).toEqual([
      'verify-vercel-env.mjs has no SYSTEM_INJECTED_VARS Set literal — a rename or restructure broke the exemption.',
    ]);
  });

  it('fails when the doc row does not document the exemption', () => {
    const doc = FIXTURE_DOC.replace(/system-injected/i, 'injected');
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc: FIXTURE_SRC, launchDoc: doc, readmeDoc: FIXTURE_README });
    expect(failures.join('\n')).toContain('omits the exemption phrase');
  });

  it('fails when the README row does not document the exemption', () => {
    const readme = FIXTURE_README.replace(/system-injected/i, 'injected');
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc: FIXTURE_SRC, launchDoc: FIXTURE_DOC, readmeDoc: readme });
    expect(failures.join('\n')).toContain('omits the exemption phrase');
  });

  it('fails when a row keeps the marker but drops a non-marker phrase', () => {
    // The new capability over the marker check: 'system-injected' survives in
    // the README row, but losing 'real project vars' still fails — CI cannot
    // be gamed by keeping one phrase while softening the contract.
    const readme = FIXTURE_README.replace('real project vars', 'other vars');
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc: FIXTURE_SRC, launchDoc: FIXTURE_DOC, readmeDoc: readme });
    expect(failures.join('\n')).toContain('real project vars');
    expect(failures.join('\n')).toContain('omits the exemption phrase');
  });

  it('fails when the doc has no vercel-env row at all', () => {
    const doc = FIXTURE_DOC.replace('| `npm run verify:vercel-env` | `VERCEL_TOKEN` |', '| `npm run verify:other` | — |');
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc: FIXTURE_SRC, launchDoc: doc, readmeDoc: FIXTURE_README });
    expect(failures.join('\n')).toContain('no vercel-env gate row');
  });

  it('fails when the README has no vercel-env row at all', () => {
    const readme = FIXTURE_README.replace('| vercel-env |', '| other-gate |');
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc: FIXTURE_SRC, launchDoc: FIXTURE_DOC, readmeDoc: readme });
    expect(failures.join('\n')).toContain('no vercel-env row');
  });

  it('ignores a vercel-env row outside the verification-gates section', () => {
    // A row mentioning the command in a LATER section must not satisfy the
    // doc requirement — the check is bounded to §4 like the rest of the drift
    // guard's parsing, so the appendix row cannot rescue a missing §4 row.
    const doc = FIXTURE_DOC.replace('| `npm run verify:vercel-env` | `VERCEL_TOKEN` |', '| `npm run verify:other` | — |')
      + '\n\n## 9. Appendix\n| `npm run verify:vercel-env` | system-injected exemption note |\n';
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc: FIXTURE_SRC, launchDoc: doc, readmeDoc: FIXTURE_README });
    expect(failures.join('\n')).toContain('no vercel-env gate row');
  });

  it('ignores a README vercel-env row outside the verification-gates section', () => {
    // Same bounding rule on the README side: a row in a later section must not
    // satisfy the requirement — only the handoff gate table counts.
    const readme = FIXTURE_README.replace('| vercel-env |', '| other-gate |')
      + '\n\n### Some other section\n| vercel-env | system-injected exemption note |\n';
    const failures = crossCheckSystemInjectedVars({ vercelEnvSrc: FIXTURE_SRC, launchDoc: FIXTURE_DOC, readmeDoc: readme });
    expect(failures.join('\n')).toContain('no vercel-env row');
  });

  it('locks the canonical set to the 16 Vercel-injected build vars', () => {
    expect([...CANONICAL_SYSTEM_INJECTED_VARS].sort()).toEqual([
      'VERCEL',
      'VERCEL_ENV',
      'VERCEL_GIT_COMMIT_AUTHOR_LOGIN',
      'VERCEL_GIT_COMMIT_AUTHOR_NAME',
      'VERCEL_GIT_COMMIT_MESSAGE',
      'VERCEL_GIT_COMMIT_REF',
      'VERCEL_GIT_COMMIT_SHA',
      'VERCEL_GIT_PREVIOUS_SHA',
      'VERCEL_GIT_PROVIDER',
      'VERCEL_GIT_PULL_REQUEST_ID',
      'VERCEL_GIT_REPO_ID',
      'VERCEL_GIT_REPO_OWNER',
      'VERCEL_GIT_REPO_SLUG',
      'VERCEL_OIDC_TOKEN',
      'VERCEL_TARGET_ENV',
      'VERCEL_URL',
    ]);
    // Real project vars must never sneak into the canonical list.
    expect(CANONICAL_SYSTEM_INJECTED_VARS.has('VERCEL_TOKEN')).toBe(false);
    expect(CANONICAL_SYSTEM_INJECTED_VARS.has('VERCEL_TEAM_ID')).toBe(false);
  });
});

// ── [3f/4] step-lock inside the drift guard ─────────────────────────────────
// Mirrors drift-guard-pipeline.test.ts: the drift guard (what CI's "Verify
// launch checklist matches scripts" job runs on every push) must keep the
// system-injected cross-check wired as a numbered step. A silent drop or
// reorder fails here instead of letting CI quietly stop enforcing the
// exemption contract.
describe('scripts/verify-launch-checklist.mjs · [3f/4] system-injected-vars step', () => {
  const driftGuard = read('scripts/verify-launch-checklist.mjs');

  it('defines the [3f/4] step heading', () => {
    // Executable heading line — a comment mention cannot satisfy this.
    expect(driftGuard).toContain("console.log('\\n[3f/4] Cross-referencing verify-vercel-env system-injected-vars exemption');");
  });

  it('imports crossCheckSystemInjectedVars from the shared gates module', () => {
    expect(driftGuard).toMatch(/import \{[^}]*crossCheckSystemInjectedVars[^}]*\} from '\.\/launch-checklist-gates\.mjs';/);
  });

  it('invokes the helper with the vercel-env source + BOTH docs and routes failures through fail()', () => {
    expect(driftGuard).toContain('const systemInjectedFailures = crossCheckSystemInjectedVars({');
    expect(driftGuard).toContain("vercelEnvSrc: read('scripts/verify-vercel-env.mjs'),");
    expect(driftGuard).toContain('launchDoc: doc,');
    expect(driftGuard).toContain("readmeDoc: read('README.md'),");
    expect(driftGuard).toContain('for (const msg of systemInjectedFailures) fail(msg);');
  });

  it('sits AFTER the [3e/4] pipeline-diagram step and BEFORE the [4/4] Summary', () => {
    const step3e = driftGuard.indexOf("console.log('\\n[3e/4]");
    const step3f = driftGuard.indexOf("console.log('\\n[3f/4]");
    const summary = driftGuard.indexOf("console.log('\\n[4/4] Summary');");
    expect(step3e).toBeGreaterThan(-1);
    expect(step3f).toBeGreaterThan(step3e);
    expect(summary).toBeGreaterThan(step3f);
  });
});
