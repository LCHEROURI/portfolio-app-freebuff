import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { crossCheckPipelineDiagrams, PIPELINE_DIAGRAM_KEY_NAMES } from './launch-checklist-gates.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

// ── crossCheckPipelineDiagrams: live repo (the real lock) ───────────────────
describe('crossCheckPipelineDiagrams (live repo)', () => {
  it('passes: both onboarding docs carry the "When each gate runs:" diagram naming every key gate', () => {
    const failures = crossCheckPipelineDiagrams({
      readmeSrc: read('README.md'),
      launchSrc: read('docs/launch.md'),
    });
    expect(failures).toEqual([]);
  });

  it('catches a diagram that drops a key job name', () => {
    // The runtime phrase contract: a picture that keeps its structure but
    // stops naming a gate must fail the drift guard, not just the unit suite.
    const mutated = read('README.md').replace('· Verify authorized domains', '· Verify domains only');
    const failures = crossCheckPipelineDiagrams({
      readmeSrc: mutated,
      launchSrc: read('docs/launch.md'),
    });
    expect(failures.join('\n')).toContain('README.md');
    expect(failures.join('\n')).toContain('Verify authorized domains');
    expect(failures.join('\n')).toContain('omits the key name');
  });
});

// ── crossCheckPipelineDiagrams: synthetic fixture (deterministic) ────────────
describe('crossCheckPipelineDiagrams (fixture)', () => {
  // Build the fixture diagram FROM the exported key-names list, so the green
  // path is guaranteed by construction (mirroring the system-injected
  // fixture) and every failure case is a single-token edit.
  const FIXTURE_DOC = [
    '# Heading',
    '',
    'Some prose.',
    '',
    'When each gate runs:',
    '',
    '```text',
    '   ┌───────────────────────────────┐',
    '   │  LOCAL — every git push       │',
    ...PIPELINE_DIAGRAM_KEY_NAMES.map((name) => `   · ${name}`),
    '   └───────────────────────────────┘',
    '```',
    '',
    'More prose.',
  ].join('\n');

  it('passes when both docs have the marker and a non-empty fenced body', () => {
    const failures = crossCheckPipelineDiagrams({
      readmeSrc: FIXTURE_DOC,
      launchSrc: FIXTURE_DOC,
    });
    expect(failures).toEqual([]);
  });

  it('passes with the launch.md parenthetical marker variant', () => {
    const launchVariant = FIXTURE_DOC.replace(
      'When each gate runs:',
      'When each gate runs (same picture as the README handoff section):',
    );
    const failures = crossCheckPipelineDiagrams({
      readmeSrc: FIXTURE_DOC,
      launchSrc: launchVariant,
    });
    expect(failures).toEqual([]);
  });

  it('flags a doc that lost the marker entirely', () => {
    const broken = FIXTURE_DOC.replace('When each gate runs:', 'The diagram used to live here.');
    const failures = crossCheckPipelineDiagrams({
      readmeSrc: broken,
      launchSrc: FIXTURE_DOC,
    });
    expect(failures.join('\n')).toContain('README.md');
    expect(failures.join('\n')).toContain('lost the "When each gate runs:" pipeline-diagram section');
    // The other doc is unaffected.
    expect(failures.join('\n')).not.toContain('docs/launch.md');
  });

  it('flags a doc that kept the marker but dropped the code fence', () => {
    // Marker present, but NO fence anywhere after it — build this doc
    // explicitly instead of editing FIXTURE_DOC (removing just the opening
    // fence would leave the closing ``` behind, which the parser reads as a
    // fence and reports as unterminated instead).
    const broken = [
      '# Heading',
      '',
      'When each gate runs:',
      '',
      '   ┌───────────────┐',
      '   │  LOCAL        │',
      '   └───────────────┘',
    ].join('\n');
    const failures = crossCheckPipelineDiagrams({
      readmeSrc: FIXTURE_DOC,
      launchSrc: broken,
    });
    expect(failures.join('\n')).toContain('docs/launch.md');
    expect(failures.join('\n')).toContain('no diagram code fence');
  });

  it('flags a doc with an empty fenced diagram body', () => {
    // Opening and closing fences present, but the body between them is only
    // whitespace — the section survives, the picture does not.
    const broken = [
      '# Heading',
      '',
      'When each gate runs:',
      '',
      '```text',
      '',
      '```',
    ].join('\n');
    const failures = crossCheckPipelineDiagrams({
      readmeSrc: FIXTURE_DOC,
      launchSrc: broken,
    });
    expect(failures.join('\n')).toContain('docs/launch.md');
    expect(failures.join('\n')).toContain('empty or unterminated diagram');
  });

  it('flags a doc with an unterminated fence', () => {
    const broken = FIXTURE_DOC.replace('\n```\n\nMore prose.', '');
    const failures = crossCheckPipelineDiagrams({
      readmeSrc: broken,
      launchSrc: FIXTURE_DOC,
    });
    expect(failures.join('\n')).toContain('README.md');
    expect(failures.join('\n')).toContain('empty or unterminated diagram');
  });

  it('flags a doc whose diagram omits a key name', () => {
    // Structure intact, but one gate stops being named — the new runtime
    // contract must catch it on the launch.md side too.
    const broken = FIXTURE_DOC.replace('· Verify authorized domains', '· Verify domains only');
    const failures = crossCheckPipelineDiagrams({
      readmeSrc: FIXTURE_DOC,
      launchSrc: broken,
    });
    expect(failures.join('\n')).toContain('docs/launch.md');
    expect(failures.join('\n')).toContain('Verify authorized domains');
    expect(failures.join('\n')).toContain('omits the key name');
  });

  it('reports BOTH docs when both lost the section', () => {
    const failures = crossCheckPipelineDiagrams({
      readmeSrc: '# No diagram at all',
      launchSrc: '# Also no diagram',
    });
    expect(failures).toHaveLength(2);
    expect(failures.join('\n')).toContain('README.md');
    expect(failures.join('\n')).toContain('docs/launch.md');
  });

  it('locks the key-names list to the five ci.yml jobs + the Gallery capture workflow', () => {
    expect(PIPELINE_DIAGRAM_KEY_NAMES).toEqual([
      'Typecheck · Lint · Test · Build',
      'Verify launch checklist matches scripts',
      'Verify deployed cron reports + rules',
      'Verify authorized domains',
      'Verify production sign-in + Firestore sync',
      'Gallery',
    ]);
  });
});
