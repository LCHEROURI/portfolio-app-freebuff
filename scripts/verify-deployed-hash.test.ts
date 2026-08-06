import { describe, expect, it, vi } from 'vitest';
import {
  compareDrift,
  extractSha,
  resolveByHost,
} from './verify-deployed-hash.mjs';

const TOKEN = 'test-token';
const TEAM = 'team_test';

// ── extractSha ────────────────────────────────────────────────────────────────
describe('extractSha', () => {
  it('prefers meta.githubCommitSha', () => {
    expect(extractSha({ meta: { githubCommitSha: 'abc123' }, gitSource: { sha: 'def456' } })).toBe('abc123');
  });

  it('falls back to gitSource.sha when meta is missing', () => {
    expect(extractSha({ gitSource: { sha: 'def456' } })).toBe('def456');
  });

  it('returns empty when neither records a commit', () => {
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

// ── resolveByHost (Vercel API mocked) ─────────────────────────────────────────
describe('resolveByHost', () => {
  it('resolves sha/url/created from the v13 deployment record', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        meta: { githubCommitSha: '76e08c209d0e' },
        url: 'portfolio-app-freebuff-abc.vercel.app',
        createdAt: '2026-08-06T01:09:10.973Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const dep = await resolveByHost('portfolio-app-freebuff.vercel.app', 'compare URL', TOKEN, TEAM);

    expect(dep.sha).toBe('76e08c209d0e');
    expect(dep.url).toBe('portfolio-app-freebuff-abc.vercel.app');
    expect(dep.created).toBe('2026-08-06T01:09:10.973Z');

    // v13 lookup by host, with the team scope, bearer token present.
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/v13/deployments/portfolio-app-freebuff.vercel.app');
    expect(String(url)).toContain('teamId=team_test');
    expect(opts.headers.authorization).toBe('Bearer test-token');
  });

  it('falls back to gitSource.sha and the v6 created field', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        gitSource: { sha: 'b8d78ce1b0a1af9' },
        url: 'portfolio-app-freebuff-old.vercel.app',
        created: '2026-08-06T01:01:16.996Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const dep = await resolveByHost('portfolio-app-freebuff-old.vercel.app', 'deployment URL', TOKEN, TEAM);

    expect(dep.sha).toBe('b8d78ce1b0a1af9');
    expect(dep.created).toBe('2026-08-06T01:01:16.996Z');
  });

  it('throws on a non-OK response so the CLI can exit 1', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(resolveByHost('missing.vercel.app', 'compare URL', TOKEN, TEAM)).rejects.toThrow(/HTTP 404/);
  });
});
