import { describe, expect, it, vi } from 'vitest';
import {
  compareDrift,
  extractSha,
  INVALID_TOKEN_MESSAGE,
  InvalidTokenError,
  isInvalidToken,
  parseArgs,
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

// ── isInvalidToken (the dead-token detector) ──────────────────────────────────
describe('isInvalidToken', () => {
  it('detects a top-level invalidToken:true flag', () => {
    expect(isInvalidToken({ invalidToken: true })).toBe(true);
  });

  it('detects the Vercel error-shape body (error.invalidToken)', () => {
    expect(
      isInvalidToken({ error: { code: 'forbidden', message: 'Not authorized.', invalidToken: true } }),
    ).toBe(true);
    expect(
      isInvalidToken({ error: { code: 'unauthorized', message: 'Not authenticated.', invalidToken: true } }),
    ).toBe(true);
  });

  it('returns false for missing, empty, or non-token error bodies', () => {
    expect(isInvalidToken(null)).toBe(false);
    expect(isInvalidToken(undefined)).toBe(false);
    expect(isInvalidToken({})).toBe(false);
    expect(isInvalidToken({ error: { code: 'forbidden' } })).toBe(false);
    expect(isInvalidToken({ error: { code: 'unauthorized' } })).toBe(false);
    expect(isInvalidToken({ invalidToken: false })).toBe(false);
  });
});

// ── parseArgs (the GitHub Actions plain-scalar folding guard) ──────────────────
describe('parseArgs', () => {
  it('parses a normal --url/--expect invocation', () => {
    const parsed = parseArgs(['--url', 'https://x.vercel.app', '--expect', 'abc123']);
    expect(parsed.url).toBe('https://x.vercel.app');
    expect(parsed.expect).toBe('abc123');
    expect(parsed.compareUrl).toBeNull();
    expect(parsed.checkLocal).toBe(false);
  });

  it('recovers flags whose leading space survived a YAML-folded run block', () => {
    // GitHub Actions folds `run: cmd \` newline into a literal backslash-space,
    // so bash hands the script ` --url` (leading space) as ONE word. The trim
    // inside parseArgs must recover the flag so the gate never silently falls
    // back to the v6 list branch — the exact 403 bug this guards against.
    const folded = [' --url', 'https://x.vercel.app', ' --expect', 'abc123', ' --compare-url', 'https://y.vercel.app'];
    const parsed = parseArgs(folded);
    expect(parsed.url).toBe('https://x.vercel.app');
    expect(parsed.expect).toBe('abc123');
    expect(parsed.compareUrl).toBe('https://y.vercel.app');
  });

  it('handles --check-local as a bare boolean flag', () => {
    expect(parseArgs(['--check-local']).checkLocal).toBe(true);
    expect(parseArgs([' --check-local']).checkLocal).toBe(true);
    expect(parseArgs([]).checkLocal).toBe(false);
  });

  it('returns null for a flag missing its value', () => {
    expect(parseArgs(['--url']).url).toBeNull();
    expect(parseArgs(['--expect']).expect).toBeNull();
    expect(parseArgs([]).url).toBeNull();
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

  it('falls back to a bare (unscoped) lookup when the team-scoped lookup 403s', async () => {
    // First call (teamId hint) → 403 forbidden; second call (bare) → deployment.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          meta: { githubCommitSha: 'ea3e4b11f2d49c17' },
          url: 'portfolio-app-freebuff-6koxcb97q-laredj-chehrouris-projects.vercel.app',
          createdAt: '2026-08-06T01:46:00.000Z',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const dep = await resolveByHost('portfolio-app-freebuff-6koxcb97q-laredj-chehrouris-projects.vercel.app', 'deployment URL', TOKEN, TEAM);

    expect(dep.sha).toBe('ea3e4b11f2d49c17');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The fallback URL carries no teamId — the bare lookup wins.
    const [fallbackUrl] = fetchMock.mock.calls[1];
    expect(String(fallbackUrl)).not.toContain('teamId');
  });

  it('still resolves via the bare lookup when no team id is known', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        meta: { githubCommitSha: 'b8d78ce1b0a1af9' },
        url: 'portfolio-app-freebuff.vercel.app',
        createdAt: '2026-08-06T01:01:16.996Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const dep = await resolveByHost('portfolio-app-freebuff.vercel.app', 'deployment URL', TOKEN, undefined);

    expect(dep.sha).toBe('b8d78ce1b0a1af9');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain('teamId');
  });

  it('throws when BOTH the team-scoped and bare lookups are rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(resolveByHost('denied.vercel.app', 'deployment URL', TOKEN, TEAM)).rejects.toThrow(/HTTP 403/);
  });

  it('throws InvalidTokenError when the 403 body carries invalidToken:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'forbidden', message: 'Not authorized.', invalidToken: true } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveByHost('dead.vercel.app', 'deployment URL', TOKEN, TEAM)).rejects.toThrow(InvalidTokenError);
    await expect(resolveByHost('dead.vercel.app', 'deployment URL', TOKEN, TEAM)).rejects.toThrow(
      INVALID_TOKEN_MESSAGE,
    );
    await expect(resolveByHost('dead.vercel.app', 'deployment URL', TOKEN, TEAM)).rejects.toThrow(/paste a fresh token/);
  });

  it('throws InvalidTokenError for the 401 error shape even with no team scope', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'unauthorized', message: 'Not authenticated.', invalidToken: true } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveByHost('dead.vercel.app', 'deployment URL', TOKEN, undefined)).rejects.toThrow(
      INVALID_TOKEN_MESSAGE,
    );
    // The bare (single-attempt) path must not call fetch twice for a 401.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the bare lookup when the team-scoped 403 carries no invalidToken', async () => {
    // First call (teamId hint) → 403 without invalidToken; second (bare) → OK.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: { code: 'forbidden' } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          meta: { githubCommitSha: 'ea3e4b11f2d49c17' },
          url: 'portfolio-app-freebuff-ok.vercel.app',
          createdAt: '2026-08-06T01:46:00.000Z',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const dep = await resolveByHost('portfolio-app-freebuff-ok.vercel.app', 'deployment URL', TOKEN, TEAM);
    expect(dep.sha).toBe('ea3e4b11f2d49c17');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
