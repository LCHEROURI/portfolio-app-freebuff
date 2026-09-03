import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  PRODUCTION_URL,
  canonicalHost,
  compareDrift,
  extractSha,
  parseArgs,
  pickNewestSucceeded,
  resolveLive,
} from './verify-deployed-hash.mjs';

// ── extractSha ────────────────────────────────────────────────────────────────
describe('extractSha', () => {
  it('reads the commit-sha label stamped by the deploy script', () => {
    expect(extractSha({ labels: { 'commit-sha': 'abc123' } })).toBe('abc123');
  });

  it('returns empty when the rollout carries no label', () => {
    expect(extractSha({ labels: {} })).toBe('');
    expect(extractSha({})).toBe('');
    expect(extractSha(null)).toBe('');
    expect(extractSha(undefined)).toBe('');
  });
});

// ── compareDrift (the drift-watch verdict) ────────────────────────────────────
describe('compareDrift', () => {
  it('returns match for identical shas', () => {
    expect(compareDrift('abc123', 'abc123')).toBe('match');
  });

  it('returns mismatch for different shas', () => {
    expect(compareDrift('abc123', 'def456')).toBe('mismatch');
  });

  it('returns unverifiable when either side records no sha', () => {
    expect(compareDrift('', 'abc123')).toBe('unverifiable');
    expect(compareDrift('abc123', '')).toBe('unverifiable');
    expect(compareDrift('', '')).toBe('unverifiable');
  });
});

// ── pickNewestSucceeded (rollout list is NOT newest-first) ────────────────────
describe('pickNewestSucceeded', () => {
  const r = (name, state, createTime, sha) => ({
    name,
    state,
    createTime,
    labels: sha ? { 'commit-sha': sha } : {},
  });

  it('ignores non-SUCCEEDED rollouts entirely', () => {
    const picked = pickNewestSucceeded([
      r('build-001', 'FAILED', '2026-09-01T10:00:00Z'),
      r('build-002', 'SUCCEEDED', '2026-09-01T11:00:00Z'),
      r('build-003', 'SUCCEEDED', '2026-09-01T12:00:00Z'),
    ]);
    expect(picked.name).toBe('build-003');
  });

  it('picks by createTime, not list order (the top-entry heuristic is wrong)', () => {
    // Deliberately out of order — a newer rollout appearing EARLIER in the
    // list must still win on time.
    const picked = pickNewestSucceeded([
      r('build-005', 'SUCCEEDED', '2026-09-02T09:00:00Z'),
      r('build-006', 'SUCCEEDED', '2026-09-02T12:00:00Z'),
      r('build-004', 'SUCCEEDED', '2026-09-02T08:00:00Z'),
    ]);
    expect(picked.name).toBe('build-006');
  });

  it('returns null when nothing has succeeded', () => {
    expect(pickNewestSucceeded([])).toBeNull();
    expect(pickNewestSucceeded([r('build-001', 'FAILED', '2026-09-01T10:00:00Z')])).toBeNull();
  });
});

// ── canonicalHost / PRODUCTION_URL (one source of truth for the live URL) ─────
describe('canonical URL', () => {
  it('points at the Firebase App Hosting hosted.app URL, not Vercel', () => {
    expect(PRODUCTION_URL).toBe('https://portfolio-app-freebuff--portfolio-app-freebuff2.us-central1.hosted.app');
    expect(canonicalHost()).toBe('portfolio-app-freebuff--portfolio-app-freebuff2.us-central1.hosted.app');
  });

  it('the gate targets the canonical URL via the shared driver', () => {
    const gateSrc = readFileSync('scripts/verify-deployed-hash-gate.mjs', 'utf8');
    expect(gateSrc).toContain("import { PRODUCTION_URL as CANONICAL_URL } from './verify-deployed-hash.mjs';");
    expect(gateSrc).toContain("'--url', CANONICAL_URL");
  });
});

// ── resolveLive (host validation happens BEFORE any network call) ─────────────
describe('resolveLive', () => {
  it('rejects a stale Vercel alias with a targeted message', async () => {
    await expect(resolveLive('portfolio-app-freebuff.vercel.app', 'fake-token')).rejects.toThrow(
      /not this backend's URL/,
    );
  });

  it('accepts the canonical host (network call mocked)', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        rollouts: [
          { name: 'projects/x/locations/us-central1/backends/b/rollouts/build-001', state: 'SUCCEEDED', createTime: '2026-09-02T12:00:00Z', labels: { 'commit-sha': 'abc123' } },
        ],
      }), { status: 200 }),
    );
    try {
      const live = await resolveLive(canonicalHost(), 'fake-token');
      expect(live.sha).toBe('abc123');
      expect(live.url).toBe(PRODUCTION_URL);
      expect(live.created).toBe('2026-09-02T12:00:00Z');
    } finally {
      mock.mockRestore();
    }
  });

  it('throws when no rollout has succeeded', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ rollouts: [{ name: 'r1', state: 'FAILED' }] }), { status: 200 }),
    );
    try {
      await expect(resolveLive(canonicalHost(), 'fake-token')).rejects.toThrow(/no SUCCEEDED rollout/);
    } finally {
      mock.mockRestore();
    }
  });
});

// ── parseArgs (the GitHub Actions plain-scalar folding guard) ──────────────────
describe('parseArgs', () => {
  it('parses a normal --url/--expect invocation', () => {
    const parsed = parseArgs(['--url', 'https://x.hosted.app', '--expect', 'abc123']);
    expect(parsed.url).toBe('https://x.hosted.app');
    expect(parsed.expect).toBe('abc123');
    expect(parsed.checkLocal).toBe(false);
    expect(parsed.compareUrl).toBeNull();
  });

  it('recovers flags folded by the GitHub Actions plain-scalar backslash', () => {
    const parsed = parseArgs([' --url', 'https://x.hosted.app', '--expect', 'abc123']);
    expect(parsed.url).toBe('https://x.hosted.app');
    expect(parsed.expect).toBe('abc123');
  });

  it('a flag whose following word is another flag consumes it (kept for CLI parity)', () => {
    // Historical parity: the flag() helper returns the next word whenever one
    // exists, so `--url --expect` reads url='--expect' and expect stays unset.
    const parsed = parseArgs(['--url', '--expect']);
    expect(parsed.url).toBe('--expect');
    expect(parsed.expect).toBeNull();
  });

  it('returns null values for absent flags', () => {
    const parsed = parseArgs([]);
    expect(parsed.url).toBeNull();
    expect(parsed.expect).toBeNull();
    expect(parsed.compareUrl).toBeNull();
    expect(parsed.checkLocal).toBe(false);
  });
});

// ── Source-level pins ─────────────────────────────────────────────────────────
describe('verify-deployed-hash.mjs · no Vercel left in the driver', () => {
  it('never references VERCEL_TOKEN or the Vercel API', () => {
    const src = readFileSync('scripts/verify-deployed-hash.mjs', 'utf8');
    expect(src).not.toContain('VERCEL_TOKEN');
    expect(src).not.toContain('api.vercel.com');
    expect(src).not.toContain('.vercel.app');
  });

  it('still emits the gate-parsed commit line format', () => {
    const src = readFileSync('scripts/verify-deployed-hash.mjs', 'utf8');
    // The stale-guard gate parses `  commit  <40-hex>` from the child report.
    expect(src).toContain("`  commit  ${deployedSha || '(unknown)'}`");
  });
});