import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/readme-pipeline.test.ts — lock the README pipeline diagram to the
// workflows it depicts.
//
// The README handoff section carries a "When each gate runs:" ASCII diagram
// showing the verification pipeline: the local pre-push hook, ship:go, the
// five ci.yml push jobs, and the three deployment_status gates. The diagram
// is documentation — if a job is renamed in ci.yml or a workflow is renamed
// and the picture is not updated, the onboarding doc drifts from reality
// silently. This test reads the REAL workflow files from disk, extracts the
// authoritative display names, and asserts each one still appears in the
// diagram, so a renamed or dropped entry fails the suite.
// ============================================================================

const README = readFileSync('README.md', 'utf8');
const CI = readFileSync('.github/workflows/ci.yml', 'utf8');
const PREVIEW_GATE = readFileSync('.github/workflows/preview-gate.yml', 'utf8');
const DEPLOYED_HASH = readFileSync('.github/workflows/verify-deployed-hash.yml', 'utf8');
const GALLERY = readFileSync('.github/workflows/gallery.yml', 'utf8');

// The five push-event jobs in ci.yml (key -> the job's display name line).
const CI_JOB_KEYS = [
  'validate',
  'verify-launch-checklist',
  'verify-deployed',
  'verify-auth-domains',
  'verify-prod-signin',
];
// The three deployment_status workflows, mapped to the file that defines them.
const DEPLOYMENT_WORKFLOWS: Array<{ name: string; src: string }> = [
  { name: 'Preview gate', src: PREVIEW_GATE },
  { name: 'Deployed-hash gate', src: DEPLOYED_HASH },
  { name: 'Gallery', src: GALLERY },
];

/** Collapse every whitespace run (including newlines) to a single space. */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The body of the "When each gate runs:" ASCII diagram (between the opening
 * and closing code fences), or '' when the section or fence is missing.
 */
export function parsePipelineDiagram(readmeText: string): string {
  const marker = readmeText.indexOf('When each gate runs:');
  if (marker === -1) return '';
  const fenceStart = readmeText.indexOf('```', marker);
  if (fenceStart === -1) return '';
  const bodyStart = fenceStart + 3;
  const fenceEnd = readmeText.indexOf('```', bodyStart);
  if (fenceEnd === -1) return '';
  return readmeText.slice(bodyStart, fenceEnd);
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
    expect(normalizedDiagram).toContain('DEPLOYMENT_STATUS GATES');
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

  it('still names every deployment_status workflow, read live from the files', () => {
    const liveNames = DEPLOYMENT_WORKFLOWS.map(({ name, src }) => ({
      expected: name,
      actual: workflowDisplayName(src),
    }));
    expect(liveNames.map((n) => n.actual)).toEqual(['Preview gate', 'Deployed-hash gate', 'Gallery']);
    for (const { expected, actual } of liveNames) {
      expect(actual).toBe(expected);
      expect(normalizedDiagram).toContain(norm(actual));
    }
  });

  it('shows exactly five ci jobs and three deployment gates (no dropped rows)', () => {
    // Count bulleted LINES, not bullet characters: the Typecheck line
    // legitimately contains three extra '·' separators in its job name.
    // Strip the box-drawing border chars first — each line reads
    // `│  · <entry>` inside the boxes.
    const bulletedLines = diagram
      .split('\n')
      .map((line) => line.replace(/[│┌┐└┘─┬▼]/g, '').trim())
      .filter((line) => line.startsWith('·'));
    expect(bulletedLines).toHaveLength(8);
  });
});
