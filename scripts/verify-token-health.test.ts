import { describe, expect, it, vi } from 'vitest';
import {
  expiryVerdict,
  fetchTokenList,
  formatExpiry,
  pickActiveToken,
} from './verify-token-health.mjs';
// The shared dead-token helpers live in verify-deployed-hash.mjs; the
// token-health script imports them rather than re-exporting, so the test
// imports them from the same source.
import {
  INVALID_TOKEN_MESSAGE,
  InvalidTokenError,
  isInvalidToken,
} from './verify-deployed-hash.mjs';

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

// ── expiryVerdict (the pure expiry decision extracted from main) ──────────────
describe('expiryVerdict', () => {
  // A fixed "now" so the tests are deterministic regardless of run time.
  const NOW = 1_800_000_000_000; // ~2027-01-15 UTC
  const DAY = 86_400_000;

  it('reports none for a token with no expiry date', () => {
    expect(expiryVerdict(null, NOW)).toEqual({ kind: 'none' });
    expect(expiryVerdict(undefined, NOW)).toEqual({ kind: 'none' });
    expect(expiryVerdict(0, NOW)).toEqual({ kind: 'none' });
  });

  it('flags a token already past its expiry as expired with a negative day count', () => {
    expect(expiryVerdict(NOW - 5 * DAY, NOW)).toEqual({ kind: 'expired', daysLeft: -5 });
    expect(expiryVerdict(NOW - 1 * DAY, NOW)).toEqual({ kind: 'expired', daysLeft: -1 });
  });

  it('flags a token inside the 90-day window as due-soon', () => {
    expect(expiryVerdict(NOW + 30 * DAY, NOW)).toEqual({ kind: 'due-soon', daysLeft: 30 });
    expect(expiryVerdict(NOW + 90 * DAY, NOW)).toEqual({ kind: 'due-soon', daysLeft: 90 });
    // Exactly on the boundary still counts as due-soon (<= 90).
    expect(expiryVerdict(NOW + 90 * DAY, NOW).kind).toBe('due-soon');
  });

  it('reports ok for a dated token comfortably beyond the 90-day window', () => {
    expect(expiryVerdict(NOW + 91 * DAY, NOW)).toEqual({ kind: 'ok', daysLeft: 91 });
    expect(expiryVerdict(NOW + 365 * DAY, NOW)).toEqual({ kind: 'ok', daysLeft: 365 });
  });

  it('uses the real clock when no now is passed', () => {
    const v = expiryVerdict(Date.now() + 30 * DAY);
    expect(v.kind).toBe('due-soon');
    expect(v.daysLeft).toBe(30);
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
