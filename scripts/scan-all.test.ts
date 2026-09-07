import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/scan-all.test.ts — lock the --notify transient-OpenRouter retry
// contract.
//
// The --notify path hits a LIVE deployed endpoint, so its pure surface is
// small; the retry behavior is contract-locked by reading the real module from
// disk (the same approach verify-cron-reports.test.ts uses), so a future edit
// that drops the retry, retries the wrong checks, or retries too many times
// fails here. The daily AI sections (executive summary + top-three narration)
// are the only provider-dependent surface in the notify path — a transient
// OpenRouter blip must not turn a good scan into a loud failure.
// ============================================================================

const SCRIPT = readFileSync('scripts/scan-all.mjs', 'utf8');

describe('scripts/scan-all.mjs · --notify AI retry-once contract', () => {
  it('defines the retry delay + sleep helper (same constants as verify-cron-reports)', () => {
    expect(SCRIPT).toContain('const AI_RETRY_DELAY_MS = 5000');
    expect(SCRIPT).toContain('const sleep = (ms) => new Promise((r) => setTimeout(r, ms));');
  });

  it('fetches the daily preview body so the AI sub-checks can inspect it', () => {
    // Without ?previewBody=1 the response strips the composed body, so the
    // AI sub-checks would silently read an empty body.
    expect(SCRIPT).toContain('return `${base}/api/cron/reports?kind=daily&previewBody=1`;');
  });

  it('retries ONCE (a second fetch, no loop) when the AI sub-checks fail on the first pass', () => {
    // Exactly one retry fetch: the notify path re-fetches the daily report once
    // and never loops. A `while` would silently turn the retry into a poller
    // that could paper over a real regression by waiting for a lucky pass, so
    // the retry block must stay loop-free.
    expect(SCRIPT).toContain('retrying once after');
    const retryBlock = SCRIPT.slice(SCRIPT.indexOf('--notify: daily AI sub-checks failed on the first pass'), SCRIPT.indexOf('daily AI exec summary + narration sub-checks pass on the first pass'));
    expect(retryBlock).not.toMatch(/while\s*\(/);
    expect(retryBlock).toContain('const retryRes = await fetch(url, {');
  });

  it('re-runs ONLY the AI sub-checks on the retry pass (deterministic ok/counts never retry)', () => {
    // The retry exists because the AI narration/exec-summary calls are the only
    // provider-dependent surface (the 8182177 flake). The ok flag and counts
    // are deterministic — they must never ride the retry.
    expect(SCRIPT).toContain('dailyAiFailures(retryReport ?? {}, retryBody)');
    // The first pass runs the same checks against the fresh response.
    expect(SCRIPT).toContain('let fails = dailyAiFailures(dailyReport, dailyBody);');
  });

  it('fails the sub-check when the retry ALSO fails (real regression stays loud)', () => {
    expect(SCRIPT).toContain('for (const f of retryFails) fail(`--notify: ${f}`);');
    // The retry must not weaken the check: a build that genuinely lost its AI
    // sections fails both passes.
    expect(SCRIPT).toContain('a real regression fails BOTH passes');
  });

  it('gates the retry on configured.openrouter=true only (unconfigured builds never retry)', () => {
    expect(SCRIPT).toContain('const aiConfigured = json.configured?.openrouter === true;');
    expect(SCRIPT).toContain('deployed app reports NO OPENROUTER_API_KEY — AI body sub-checks SKIP');
    expect(SCRIPT).toContain('predates the configured.openrouter field');
  });

  it('checks the narration only when present (data-dependent graceful path)', () => {
    // No actionable top three → narration is null and the section is omitted by
    // design; the exec-summary heading + raw footer still ship. The narration
    // checks must be conditional so a quiet day never fails the notify path.
    expect(SCRIPT).toContain('const narration = report?.narration;');
    expect(SCRIPT).toContain('if (narration) {');
  });
});