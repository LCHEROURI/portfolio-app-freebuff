import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/drift-guard-pipeline.test.ts — lock the [3e/4] pipeline-diagram
// step contract inside the launch-checklist drift guard.
//
// The drift guard (scripts/verify-launch-checklist.mjs) is what CI's
// "Verify launch checklist matches scripts" job runs on every push — and
// since commit 60a8361 it carries a [3e/4] step that fails the run if either
// onboarding doc (README.md or docs/launch.md) loses the "When each gate
// runs:" pipeline-diagram section. The readme-pipeline.test.ts suite locks
// the diagram's CONTENT; this suite locks the guard's PRESENCE — a future
// edit that silently drops or reorders the [3e/4] step fails here instead of
// letting CI quietly stop enforcing the picture.
//
// Reads the REAL script from disk (never a fixture): a missing file THROWS
// loudly rather than passing vacuously. The assertions target executable
// code lines, not the comment above the step — a comment mention could
// survive a step deletion and pass vacuously, so every assertion pins a
// load-bearing statement (the console.log heading, the import, the
// crossCheckPipelineDiagrams invocation with BOTH docs, the ok message) and
// the step's position between [3d/4] and the [4/4] Summary.
// ============================================================================

const DRIFT_GUARD = 'scripts/verify-launch-checklist.mjs';
const driftGuard = readFileSync(DRIFT_GUARD, 'utf8');

describe('scripts/verify-launch-checklist.mjs · [3e/4] pipeline-diagram presence step', () => {
  it('defines the [3e/4] step as the pipeline-diagram presence check', () => {
    // Executable heading line — a comment mention cannot satisfy this.
    expect(driftGuard).toContain("console.log('\\n[3e/4] Cross-referencing onboarding-doc pipeline-diagram presence');");
  });

  it('imports crossCheckPipelineDiagrams from the shared gates module', () => {
    // Anchor on the braces + from-clause so the assertion holds whether the
    // (long, six-name) import stays single-line or a formatter wraps it
    // multi-line — a `^import .*from …$` anchor would false-fail on a
    // legitimate reformat that keeps the import semantically identical.
    expect(driftGuard).toMatch(/import \{[^}]*crossCheckPipelineDiagrams[^}]*\} from '\.\/launch-checklist-gates\.mjs';/);
  });

  it('reads BOTH onboarding docs: README.md via the README const and launch.md via doc', () => {
    // readmeSrc must resolve to README.md (the const, not a hardcoded string
    // that could drift from the const declaration), launchSrc to the already
    // parsed launch.md. Assert the const declaration and the invocation.
    expect(driftGuard).toMatch(/^const README = 'README\.md';$/m);
    expect(driftGuard).toContain('readmeSrc: read(README),');
    expect(driftGuard).toContain('launchSrc: doc,');
  });

  it('invokes the helper and routes its failures through the shared fail()', () => {
    // The invocation must exist as code AND its failures must feed the same
    // fail() collector the other drift-guard steps use — a dropped loop would
    // silently swallow the check.
    expect(driftGuard).toContain('const diagramFailures = crossCheckPipelineDiagrams({');
    expect(driftGuard).toContain('for (const msg of diagramFailures) fail(msg);');
    expect(driftGuard).toContain("ok('README.md and docs/launch.md both carry the \"When each gate runs:\" pipeline diagram');");
  });

  it('sits AFTER the [3d/4] deployment-status step and BEFORE the [4/4] Summary', () => {
    // Ordering pins: the step must be part of the numbered drift-guard flow,
    // not appended after the summary (where a failure could still print but
    // the summary/exit logic would already have run) and not moved before
    // the CI-gating checks. Line-anchored against the executable console.log
    // headings, so a comment mentioning "[3e/4]" can't satisfy the pin.
    const step3d = driftGuard.indexOf("console.log('\\n[3d/4]");
    const step3e = driftGuard.indexOf("console.log('\\n[3e/4]");
    const summary = driftGuard.indexOf("console.log('\\n[4/4] Summary');");
    expect(step3d).toBeGreaterThan(-1);
    expect(step3e).toBeGreaterThan(step3d);
    expect(summary).toBeGreaterThan(step3e);
  });
});
