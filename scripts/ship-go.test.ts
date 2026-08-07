import { describe, expect, it } from 'vitest';

import { DEFAULT_MESSAGE, isSkipMarker, parseArgs, pollDecision } from './ship-go.mjs';

// ── parseArgs: CLI flags → plan object ─────────────────────────────────────
describe('parseArgs', () => {
  it('defaults message, branch, wait, and poll when nothing is given', () => {
    const a = parseArgs([]);
    expect(a.message).toBe(DEFAULT_MESSAGE);
    expect(a.branch).toBe('main');
    expect(a.maxWaitSec).toBe(360);
    expect(a.pollIntervalSec).toBe(15);
    expect(a.dryRun).toBe(false);
  });

  it('takes the commit message from --message', () => {
    expect(parseArgs(['--message', 'feat(x): ship it']).message).toBe('feat(x): ship it');
  });

  it('takes the first non-flag argument as the commit message', () => {
    expect(parseArgs(['feat(y): ship it']).message).toBe('feat(y): ship it');
    expect(parseArgs(['--branch', 'main', 'fix(z): ship it']).message).toBe('fix(z): ship it');
  });

  it('parses --branch, --max-wait, --poll, and --dry-run', () => {
    const a = parseArgs(['--branch', 'release', '--max-wait', '600', '--poll', '30', '--dry-run']);
    expect(a.branch).toBe('release');
    expect(a.maxWaitSec).toBe(600);
    expect(a.pollIntervalSec).toBe(30);
    expect(a.dryRun).toBe(true);
  });

  it('falls back to defaults for non-numeric or non-positive wait/poll values', () => {
    expect(parseArgs(['--max-wait', 'abc']).maxWaitSec).toBe(360);
    expect(parseArgs(['--poll', '-5']).pollIntervalSec).toBe(15);
    expect(parseArgs(['--max-wait', '0']).maxWaitSec).toBe(360);
  });

  it('does not swallow a following flag as a flag value', () => {
    const a = parseArgs(['--branch', '--dry-run']);
    expect(a.branch).toBe('main');
    expect(a.dryRun).toBe(true);
  });

  it('an explicit --message anywhere wins over a positional message', () => {
    expect(parseArgs(['feat: positional', '--message', 'feat: flag']).message).toBe('feat: flag');
    expect(parseArgs(['--message', 'feat: flag', 'feat: positional']).message).toBe('feat: flag');
  });

  it('a trailing value-less flag falls back to its default', () => {
    expect(parseArgs(['--branch']).branch).toBe('main');
    expect(parseArgs(['--max-wait']).maxWaitSec).toBe(360);
  });

  it('trims stray whitespace around args', () => {
    const a = parseArgs([' --message ', '  feat: trimmed  ']);
    expect(a.message).toBe('feat: trimmed');
  });
});

// ── isSkipMarker: detect verify-deployed-hash's skipped-assertion output ────
describe('isSkipMarker', () => {
  it('detects the no-commit-sha skip marker', () => {
    expect(isSkipMarker('  ⚠ no commit sha recorded for this deployment (CLI/prebuilt deploy without git metadata?)')).toBe(true);
    expect(isSkipMarker('  → skipping the assertion (not a mismatch)')).toBe(true);
  });

  it('returns false for a genuine match output, empty, or undefined', () => {
    expect(isSkipMarker('  ✓ deployed commit matches --expect abc123')).toBe(false);
    expect(isSkipMarker('')).toBe(false);
    expect(isSkipMarker(undefined)).toBe(false);
  });

  it('does not trigger on a partial phrase (the full marker is required)', () => {
    expect(isSkipMarker('no commit sha anywhere in a plain log line')).toBe(false);
  });
});

// ── pollDecision: deploy-poll exit code + attempt → next action ────────────
describe('pollDecision', () => {
  it('declares deployed immediately on exit 0', () => {
    expect(pollDecision(0, 1, 24)).toBe('deployed');
  });

  it('declares token-invalid on exit 2 without waiting (dead token cannot revive)', () => {
    expect(pollDecision(2, 1, 24)).toBe('token-invalid');
  });

  it('keeps waiting when not deployed and attempts remain', () => {
    expect(pollDecision(1, 3, 24)).toBe('keep-waiting');
  });

  it('times out on the final attempt', () => {
    expect(pollDecision(1, 24, 24)).toBe('timeout');
  });

  it('never exceeds the attempt ceiling', () => {
    expect(pollDecision(1, 24, 12)).toBe('timeout');
  });
});
