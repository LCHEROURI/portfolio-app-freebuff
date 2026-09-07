import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/verify-cron-reports.test.ts — lock the transient-OpenRouter retry
// contract.
//
// The gate hits a LIVE deployed endpoint, so its pure surface is small; the
// retry behavior is contract-locked by reading the real module from disk (the
// same approach the other gate tests use), so a future edit that drops the
// retry, retries the wrong checks, or retries too many times fails here.
// ============================================================================

const SCRIPT = readFileSync('scripts/verify-cron-reports.mjs', 'utf8');

describe('scripts/verify-cron-reports.mjs · AI retry-once contract', () => {
  it('defines the retry delay + sleep helper', () => {
    expect(SCRIPT).toContain('const AI_RETRY_DELAY_MS = 5000');
    expect(SCRIPT).toContain('const sleep = (ms) => new Promise((r) => setTimeout(r, ms));');
  });

  it('retries ONCE (a second fetch, no loop) when the AI sub-checks fail on the first pass', () => {
    // Exactly one retry fetch: the helper re-fetches the preview body once and
    // never loops. A `while` inside the helper would silently turn the retry
    // into a poller that could paper over a real regression by waiting for a
    // lucky pass, so the helper body must stay loop-free.
    expect(SCRIPT).toContain('retrying once after');
    expect(SCRIPT).toContain('const retryResp = await getJson(`/api/cron/reports?kind=${kind}&previewBody=1`, auth);');
    const helper = SCRIPT.slice(SCRIPT.indexOf('const withAiRetry'), SCRIPT.indexOf('// 1. Auth gate.'));
    expect(helper).not.toMatch(/while\s*\(/);
  });

  it('re-runs ONLY the AI exec-summary sub-checks on the retry pass', () => {
    // The retry exists because the AI exec-summary call is the only
    // provider-dependent surface (the 8182177 flake). Deterministic checks
    // (titles, sections, envelope sweep) must never ride the retry — a body
    // that is missing its title is a real regression on BOTH passes.
    expect(SCRIPT).toContain("aiExecFailures(kind, body).length === 0");
    expect(SCRIPT).toContain("if (!body.includes('## ✨ AI executive summary (DeepSeek Chat)'))");
    expect(SCRIPT).toContain("if (!body.includes('Model: `deepseek/deepseek-chat`'))");
  });

  it('fails the sub-check when the retry ALSO fails (real regression stays red)', () => {
    expect(SCRIPT).toContain('for (const f of fails) fail(f, `${kind}-body`);');
    // The retry must not weaken the gate: a build that genuinely lost its AI
    // sections fails both passes, and the section counter still sees it.
    expect(SCRIPT).toContain('build that genuinely lost its AI sections fails BOTH passes');
  });

  it('gates the retry on aiRequired only (unconfigured builds never retry)', () => {
    expect(SCRIPT).toContain("if (!aiRequired || aiExecFailures(kind, body).length === 0) return { report, body };");
    // The SKIP path for unconfigured builds is untouched.
    expect(SCRIPT).toContain('deployed app reports NO OPENROUTER_API_KEY — AI body sub-checks SKIP');
  });

  it('applies the retry to all three report kinds', () => {
    expect(SCRIPT).toContain("await withAiRetry('weekly', weeklyResp)");
    expect(SCRIPT).toContain("await withAiRetry('daily', dailyResp)");
    expect(SCRIPT).toContain("await withAiRetry('monthly', monthlyResp)");
  });

  it('keeps the envelope sweep on the RAW first-pass responses (never retried)', () => {
    // The envelope sweep is deterministic — a retry could re-fetch a different
    // (transiently envelope-free) pass and mask a re-introduced envelope. It
    // must read the same first-pass responses the auth/body checks used.
    expect(SCRIPT).toContain("['weekly', weeklyResp.json], ['daily', dailyResp.json], ['monthly', monthlyResp.json]");
    // The sweep loop must read the first-pass responses, not the retried ones.
    expect(SCRIPT).toContain('for (const [label, resp] of');
  });

  it('counts retry engagements for the blip-frequency marker', () => {
    // The retry counter increments exactly when the retry ENGAGES and when it
    // CLEARS, so the marker's frequency telemetry is accurate per run.
    expect(SCRIPT).toContain('let aiRetriesEngaged = 0;');
    expect(SCRIPT).toContain('let aiRetriesCleared = 0;');
    expect(SCRIPT).toContain('aiRetriesEngaged += 1;');
    expect(SCRIPT).toContain('aiRetriesCleared += 1;');
  });

  it('emits the VERIFY-AI-RETRY marker on EVERY run with engaged/cleared counts', () => {
    // Emitted unconditionally (engaged=0 included) so CI can distinguish "no
    // retry this run" from "marker missing" (a script regression).
    expect(SCRIPT).toContain('console.log(`VERIFY-AI-RETRY|engaged=${aiRetriesEngaged}|cleared=${aiRetriesCleared}`);');
    // The marker must ride on the stdout CI parses (same stream as the
    // VERIFY-SUBRESULT markers verify-all.mjs consumes).
    expect(SCRIPT).toContain('VERIFY-AI-RETRY');
  });
});