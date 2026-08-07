import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/capture-docs.test.ts — lock the --check (docs-render diff gate)
// contract inside scripts/capture-docs.mjs.
//
// Reads the REAL script from disk (never a fixture): the pre-push gate 0.6c
// and the `verify:docs-render` npm script both run `capture-docs.mjs --check`,
// and the whole point is that a future edit which turns the diff mode into a
// silent no-op (or worse, back into a write mode) fails here. The assertions
// target the load-bearing code paths: the --check flag is parsed, renders go
// to a throwaway temp dir (never the committed screenshots/), the fresh PNGs
// are byte-compared with the committed baseline, exit 1 carries the
// re-capture-and-commit guidance, missing baselines SKIP-not-fail (the hook's
// contract), the temp dir is cleaned up, and the PASS message is distinct.
// ============================================================================

const SCRIPT_PATH = 'scripts/capture-docs.mjs';
const script = readFileSync(SCRIPT_PATH, 'utf8');

describe('scripts/capture-docs.mjs · --check (docs-render diff gate)', () => {
  it('parses a --check flag distinct from the --out write target', () => {
    expect(script).toContain("args.includes('--check')");
    expect(script).toContain("valOf('--out')");
  });

  it('renders --check captures into a throwaway temp dir, never the committed screenshots/', () => {
    expect(script).toContain('mkdtemp');
    expect(script).toContain('tmpdir');
    expect(script).toContain('renderDir = isCheck ? await mkdtemp');
    // The write loop must target renderDir, not outArg, when checking — a
    // regression back to `writeFile(`${outArg}/${page.name}`...` would
    // overwrite the committed PNGs on every push.
    expect(script).toContain('writeFile(`${renderDir}/${page.name}`');
  });

  it('byte-compares the fresh render with the committed baseline PNG', () => {
    expect(script).toContain('readFile(`${outArg}/${page.name}`)');
    expect(script).toContain('readFile(`${renderDir}/${page.name}`)');
    expect(script).toContain('.equals(');
  });

  it('exits 1 with re-capture-and-commit guidance when any PNG would change', () => {
    expect(script).toContain('docs-render gate FAILED');
    expect(script).toContain("run 'npm run capture:docs' and commit the updated PNGs");
    expect(script).toContain('process.exit(1)');
  });

  it('SKIPS (exit 0, never fails) when there is no committed baseline to compare', () => {
    expect(script).toContain('skipped.length === pages.length');
    expect(script).toContain('no committed baseline PNGs');
    expect(script).toContain('process.exit(0)');
  });

  it('cleans up the temp dir on EVERY exit path via the synchronous exit handler', () => {
    // rmSync (not async rm) because exit handlers must be synchronous; the
    // handler runs on normal completion, process.exit, uncaught render-loop
    // errors, and signals alike, so a crashed run never leaks a temp dir.
    expect(script).toContain('rmSync(tempRenderDir, { recursive: true, force: true })');
    expect(script).toContain('process.on(\'exit\', cleanup)');
    expect(script).toContain('tempRenderDir = isCheck ? renderDir : null;');
  });

  it('distinguishes a missing baseline (skip) from a missing fresh render (hard error)', () => {
    // Baseline read has its OWN try: only a genuinely absent committed PNG is
    // skipped. A fresh-render read failure is a hard exit(1), never conflated
    // with a missing baseline.
    expect(script).toContain('let baseline;');
    expect(script).toContain('has no committed baseline in');
    expect(script).toContain('fresh render missing after capture');
    // Scope the exit(1) to the fresh-missing branch: the script has FIVE
    // process.exit(1) calls (section-missing, Chrome-error, DevTools-fail,
    // fresh-missing, changed-fail), so a bare toContain would pass even if
    // this branch's own exit were deleted. Assert it appears within the 4
    // lines after the fresh-missing error line instead.
    const freshMissing = script.indexOf('fresh render missing after capture');
    expect(freshMissing).toBeGreaterThan(-1);
    const freshBranch = script.slice(freshMissing, freshMissing + 260);
    expect(freshBranch).toMatch(/process\.exit\(1\)/);
  });

  it('names skipped baselines in the mixed PASS message so PASS is never read as all-baselines-existed', () => {
    expect(script).toContain('baseline(s) missing, skipped');
  });

  it('prints a distinct PASS message when every committed PNG matches', () => {
    expect(script).toContain('docs-render gate PASS');
  });

  it('documents the --check mode in the header usage block', () => {
    expect(script).toContain('--check          # fail if committed PNGs would change');
  });
});
