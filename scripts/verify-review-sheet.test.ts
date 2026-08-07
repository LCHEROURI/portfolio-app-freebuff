import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/verify-review-sheet.test.ts — lock the deterministic capture +
// --check byte-gate contract inside scripts/verify-review-sheet.mjs.
//
// The review-sheet pair (screenshots/review-sheet-*.png) used to drift run to
// run because the AI winner-recommendation note text is non-deterministic.
// This suite locks the mechanism that makes the pair byte-stable — CDP Fetch
// interception that pins BOTH variable fields (note + winner) — plus the
// --check mode that byte-compares the captured pair against the committed
// PNGs (the same gate contract capture-docs.mjs --check gives the docs PNGs).
// Reads the REAL script from disk (never a fixture): a future edit that
// weakens the interception (so notes drift again), drops the winner pin, or
// turns --check into a silent no-op fails here instead of letting the byte
// gate masquerade as verification.
// ============================================================================

const SCRIPT_PATH = 'scripts/verify-review-sheet.mjs';
const script = readFileSync(SCRIPT_PATH, 'utf8');

describe('scripts/verify-review-sheet.mjs · deterministic capture mode', () => {
  it('defines the REVIEW_SHEET_DETERMINISTIC flag and a fixed fixture note', () => {
    expect(script).toContain("process.env.REVIEW_SHEET_DETERMINISTIC === '1'");
    expect(script).toContain("const FIXTURE_NOTE =");
  });

  it('--check implies deterministic mode (the byte gate cannot work without it)', () => {
    expect(script).toContain('const DETERMINISTIC = isCheck ||');
  });

  it('enables CDP Fetch interception scoped to the recommend-winner API only', () => {
    // The interception must target exactly the AI route that carries the note;
    // a broader pattern would pause unrelated requests and risk hanging the run.
    expect(script).toContain("urlPattern: '*://*/*api/ai/recommend-winner*'");
    expect(script).toContain("requestStage: 'Response'");
  });

  it('pins the note to the fixture string in the fulfilled response', () => {
    expect(script).toContain('json.recommendation.note = FIXTURE_NOTE;');
    expect(script).toContain("main.send('Fetch.fulfillRequest'");
    // The response must be fulfilled (not just continued) so the rewritten
    // body actually reaches the page's JS.
    expect(script).toContain("name: 'content-type', value: 'application/json'");
  });

  it('pins the winner deterministically from the request candidates (top overallScore)', () => {
    // The note alone is not enough: the "Recommended: X Build" line comes from
    // recommendedVersionId, which the AI picks non-deterministically. The pin
    // must use the request's own candidates (the page's fallback choice).
    expect(script).toContain('Fetch.getRequestPostData');
    expect(script).toContain('json.recommendation.recommendedVersionId = top.versionId;');
    expect(script).toContain('c.overallScore > best.overallScore');
  });

  it('never hangs the run when interception fails (continues the request)', () => {
    expect(script).toContain('Fetch.continueRequest');
  });

  it('retries the sign-in submit once on a transient network failure', () => {
    // Firebase sign-in can fail with auth/network-request-failed on the first
    // request after idle; without the retry the byte gate (and the structural
    // gate) would fail whole runs on a network blip. The retry must re-fill
    // the form (a failed attempt may clear it) and fire ONCE, not loop.
    expect(script).toContain('signInRetried = false;');
    expect(script).toContain('retrying the submit once (transient network)');
    expect(script).toContain('signInRetried = true;');
  });
});

describe('scripts/verify-review-sheet.mjs · --check byte gate', () => {
  it('parses a --check flag distinct from the plain capture', () => {
    expect(script).toContain("args.includes('--check')");
  });

  it('byte-compares the captured pair against the committed screenshots/ PNGs', () => {
    expect(script).toContain('review-sheet-panels.png');
    expect(script).toContain('review-sheet-preview.png');
    expect(script).toContain('.equals(');
    expect(script).toContain('WOULD CHANGE (the deployed app altered the review-sheet visuals)');
  });

  it('exits 1 with re-capture-and-commit guidance when any PNG would change', () => {
    expect(script).toContain('review-sheet byte gate FAILED');
    expect(script).toContain("run 'npm run capture:screenshots'");
    expect(script).toContain('process.exit(1)');
  });

  it('SKIPS (exit 0, never fails) when there is no committed baseline to compare', () => {
    expect(script).toContain('no committed baseline PNGs in screenshots/');
    expect(script).toContain('process.exit(0)');
  });

  it('prints a distinct PASS message when the committed pair matches today\'s capture', () => {
    expect(script).toContain('review-sheet byte gate PASS');
  });
});
