import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PIPELINE_DIAGRAM_KEY_NAMES } from './launch-checklist-gates.mjs';

// ============================================================================
// scripts/readme-pipeline.test.ts — lock the README pipeline diagram to the
// workflows it depicts, and to the twin diagram in docs/launch.md.
//
// The README handoff section carries a "When each gate runs:" ASCII diagram
// showing the verification pipeline: the local pre-push hook, ship:go, the
// five ci.yml push jobs, and the three deployment_status gates. docs/launch.md
// §4 carries the same picture so the two onboarding surfaces share one visual.
// The diagrams are documentation — if a job is renamed in ci.yml or a workflow
// is renamed and the picture is not updated, the onboarding docs drift from
// reality silently. This test reads the REAL workflow files from disk,
// extracts the authoritative display names, and asserts each one still appears
// in the README diagram; it also asserts the launch.md diagram is byte-
// identical to the README one, so the two docs can never drift apart.
// ============================================================================

const README = readFileSync('README.md', 'utf8');
const LAUNCH = readFileSync('docs/launch.md', 'utf8');
const CI = readFileSync('.github/workflows/ci.yml', 'utf8');
const GALLERY = readFileSync('.github/workflows/gallery.yml', 'utf8');

// The five push-event jobs in ci.yml (key -> the job's display name line).
const CI_JOB_KEYS = [
  'validate',
  'verify-launch-checklist',
  'verify-deployed',
  'verify-auth-domains',
  'verify-prod-signin',
];
// The one non-ci workflow that fires per repo activity (gallery — a PR/dispatch
// capture). The legacy Vercel deployment_status gates (Preview gate,
// Deployed-hash gate) were removed when the deploy moved to Firebase App
// Hosting; the diagram now shows the build jobs plus the gallery capture.
const DEPLOYMENT_WORKFLOWS: Array<{ name: string; src: string }> = [
  { name: 'Gallery', src: GALLERY },
];

/** Collapse every whitespace run (including newlines) to a single space. */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The body of the "When each gate runs:" ASCII diagram (between the opening
 * and closing code fences), or '' when the section or fence is missing.
 *
 * The marker is matched without the trailing colon so both variants resolve:
 * README's "When each gate runs:" and launch.md's "When each gate runs (same
 * picture as the README handoff section):".
 */
export function parsePipelineDiagram(docText: string): string {
  // Line-anchored so a future prose mention of the phrase (e.g. in a
  // paragraph before the diagram) can't be mistaken for the lead-in.
  const marker = docText.search(/^When each gate runs/m);
  if (marker === -1) return '';
  const fenceStart = docText.indexOf('```', marker);
  if (fenceStart === -1) return '';
  const bodyStart = fenceStart + 3;
  const fenceEnd = docText.indexOf('```', bodyStart);
  if (fenceEnd === -1) return '';
  return docText.slice(bodyStart, fenceEnd);
}

/**
 * A job's display name from ci.yml source: the first 4-space-indented
 * `name:` line inside the job block starting at `  <jobKey>:`. Returns ''
 * when the job or its name line is missing.
 */
export function jobDisplayName(ciSrc: string, jobKey: string): string {
  const jobStart = ciSrc.indexOf(`  ${jobKey}:`);
  if (jobStart === -1) return '';
  return ciSrc.slice(jobStart).match(/^    name:\s*(.*)$/m)?.[1]?.trim() ?? '';
}

/** The top-level workflow display name from a workflow file, or ''. */
export function workflowDisplayName(src: string): string {
  return src.match(/^name:\s*(.*)$/m)?.[1]?.trim() ?? '';
}

describe('parsePipelineDiagram (pure helper)', () => {
  it('extracts the diagram body between the code fences', () => {
    const readme = [
      'When each gate runs:',
      '',
      '```text',
      '   ┌───────────┐',
      '   │  GITHUB   │',
      '   └───────────┘',
      '```',
      '### Next section',
    ].join('\n');
    expect(parsePipelineDiagram(readme)).toContain('GITHUB');
    expect(parsePipelineDiagram(readme)).not.toContain('Next section');
  });

  it('matches the marker with a parenthetical suffix (launch.md variant)', () => {
    const launch = [
      'When each gate runs (same picture as the README handoff section):',
      '',
      '```text',
      '   ┌───────────┐',
      '   │  LAUNCH   │',
      '   └───────────┘',
      '```',
    ].join('\n');
    expect(parsePipelineDiagram(launch)).toContain('LAUNCH');
  });

  it("returns '' when the section marker is missing", () => {
    expect(parsePipelineDiagram('# no diagram here')).toBe('');
  });

  it("returns '' when the code fence is missing", () => {
    expect(parsePipelineDiagram('When each gate runs:\n\nno fence here')).toBe('');
  });
});

describe('jobDisplayName / workflowDisplayName (pure helpers)', () => {
  it('extracts a 4-space job name from a ci.yml block', () => {
    const ci = [
      '  validate:',
      '    name: Typecheck · Lint · Test · Build',
      '    runs-on: ubuntu-latest',
      '  verify-deployed:',
      '    name: Verify deployed cron reports + rules',
    ].join('\n');
    expect(jobDisplayName(ci, 'validate')).toBe('Typecheck · Lint · Test · Build');
    expect(jobDisplayName(ci, 'verify-deployed')).toBe('Verify deployed cron reports + rules');
  });

  it("returns '' for a missing job key", () => {
    expect(jobDisplayName('  validate:\n    name: X\n', 'nope')).toBe('');
  });

  it('extracts the top-level workflow name', () => {
    expect(workflowDisplayName('name: Gallery\n\non:\n')).toBe('Gallery');
    expect(workflowDisplayName('on: push')).toBe('');
  });
});

describe('README pipeline diagram contract', () => {
  const diagram = parsePipelineDiagram(README);
  const normalizedDiagram = norm(diagram);

  it('has the "When each gate runs:" diagram in the handoff section', () => {
    expect(diagram).not.toBe('');
    expect(README).toContain('When each gate runs:');
    expect(normalizedDiagram).toContain('ci.yml (push event)');
  });

  it('still names every ci.yml push job, read live from the workflow', () => {
    const liveNames = CI_JOB_KEYS.map((key) => jobDisplayName(CI, key));
    // Ground truth: the parser must resolve the real five names, not '' stubs.
    expect(liveNames).toEqual([
      'Typecheck · Lint · Test · Build',
      'Verify launch checklist matches scripts',
      'Verify deployed cron reports + rules',
      'Verify authorized domains',
      'Verify production sign-in + Firestore sync',
    ]);
    for (const name of liveNames) {
      expect(normalizedDiagram).toContain(norm(name));
    }
  });

  it('still names every non-ci workflow, read live from the files', () => {
    const liveNames = DEPLOYMENT_WORKFLOWS.map(({ name, src }) => ({
      expected: name,
      actual: workflowDisplayName(src),
    }));
    expect(liveNames.map((n) => n.actual)).toEqual(['Gallery']);
    for (const { expected, actual } of liveNames) {
      expect(actual).toBe(expected);
      expect(normalizedDiagram).toContain(norm(actual));
    }
  });

  it('PIPELINE_DIAGRAM_KEY_NAMES matches the live workflow display names', () => {
    // The exported key-names list is the drift guard's source of truth — it
    // must equal the display names read live from ci.yml and the three
    // deployment_status files, so a job/workflow rename that updates the
    // diagram but forgets the list (or vice versa) fails here, keeping the
    // runtime check honest about what the gate inventory actually is.
    const liveNames = [
      ...CI_JOB_KEYS.map((key) => jobDisplayName(CI, key)),
      ...DEPLOYMENT_WORKFLOWS.map(({ src }) => workflowDisplayName(src)),
    ];
    // Ground-truth sanity: none may resolve to '' — a renamed job key would
    // silently produce an empty stub and still pass a naive equality.
    expect(liveNames).not.toContain('');
    expect(PIPELINE_DIAGRAM_KEY_NAMES).toEqual(liveNames);
  });

  it('shows exactly five ci jobs and one gallery capture (no dropped rows)', () => {
    // Count bulleted LINES, not bullet characters: the Typecheck line
    // legitimately contains three extra '·' separators in its job name.
    // Strip the box-drawing border chars first — each line reads
    // `│  · <entry>` inside the boxes.
    const bulletedLines = diagram
      .split('\n')
      .map((line) => line.replace(/[│┌┐└┘─┬▼]/g, '').trim())
      .filter((line) => line.startsWith('·'));
    expect(bulletedLines).toHaveLength(6);
  });
});

describe('README and launch.md diagrams stay byte-identical', () => {
  const readmeDiagram = parsePipelineDiagram(README);
  const launchDiagram = parsePipelineDiagram(LAUNCH);

  it('launch.md carries the same "When each gate runs:" diagram', () => {
    expect(launchDiagram).not.toBe('');
    expect(LAUNCH).toContain('When each gate runs');
    expect(launchDiagram).toContain('ci.yml (push event)');
  });

  it('both docs render the identical diagram byte for byte', () => {
    // Self-contained: assert both non-empty here so the equality can't pass
    // vacuously if the sibling README block were ever removed.
    expect(readmeDiagram).not.toBe('');
    expect(launchDiagram).not.toBe('');
    expect(launchDiagram).toBe(readmeDiagram);
  });
});
