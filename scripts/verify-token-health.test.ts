import { describe, expect, it, vi } from 'vitest';
import {
  fetchTokenList,
  formatExpiry,
  INVALID_TOKEN_MESSAGE,
  InvalidTokenError,
  isInvalidToken,
  pickActiveToken,
} from './verify-token-health.mjs';

const TOKEN = 'test-token';

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
    expect(isInvalidToken({ invalidToken: false })).toBe(false);
  });
});

// ── pickActiveToken (the manual-vs-website-login classifier) ──────────────────
describe('pickActiveToken', () => {
  it('picks the most recently created manual-origin token', () => {
    const tokens = [
      { name: 'Website, Login with Google', origin: 'google', createdAt: 1_800_000_000_000 },
      { name: 'freebuff-portfolio', origin: 'manual', createdAt: 1_780_000_000_000 },
      { name: 'newer-manual', origin: 'manual', createdAt: 1_790_000_000_000 },
    ];
    expect(pickActiveToken(tokens)?.name).toBe('newer-manual');
  });

  it('ignores website-login session tokens entirely', () => {
    const tokens = [
      { name: 'Website, Login with one-time password', origin: 'email', createdAt: 1_790_000_000_000 },
      { name: 'Website, Login with GitHub', origin: 'github', createdAt: 1_800_000_000_000 },
    ];
    expect(pickActiveToken(tokens)).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(pickActiveToken([])).toBeNull();
    expect(pickActiveToken(undefined)).toBeNull();
  });
});

// ── formatExpiry ─────────────────────────────────────────────────────────────
describe('formatExpiry', () => {
  it('formats an epoch-ms expiry as YYYY-MM-DD', () => {
    expect(formatExpiry(1_780_000_000_000)).toBe('2026-05-28');
  });

  it('reports no expiration for missing / null / zero', () => {
    expect(formatExpiry(undefined)).toBe('no expiration');
    expect(formatExpiry(null)).toBe('no expiration');
    expect(formatExpiry(0)).toBe('no expiration');
  });
});

// ── fetchTokenList (Vercel API mocked) ───────────────────────────────────────
describe('fetchTokenList', () => {
  it('hits /v2/user/tokens with the bearer token and parses the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tokens: [{ name: 'freebuff-portfolio', origin: 'manual' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { res, body } = await fetchTokenList(TOKEN);

    expect(res.ok).toBe(true);
    expect(body.tokens[0].name).toBe('freebuff-portfolio');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.vercel.com/v2/user/tokens');
    expect(opts.headers.authorization).toBe('Bearer test-token');
  });

  it('carries the response status through for the caller to decide', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'forbidden', invalidToken: true } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { res, body } = await fetchTokenList(TOKEN);

    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(isInvalidToken(body)).toBe(true);
  });

  it('surfaces the InvalidTokenError contract used by the pre-push rc=2 branch', () => {
    const err = new InvalidTokenError();
    expect(err.message).toBe(INVALID_TOKEN_MESSAGE);
    expect(err.name).toBe('InvalidTokenError');
    expect(err).toBeInstanceOf(Error);
  });
});
