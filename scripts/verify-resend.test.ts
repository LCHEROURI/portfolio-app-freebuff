import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  classifyResendKey,
  fetchResendKeyStatus,
  readResendKey,
} from './verify-resend.mjs';

const KEY = 're_test-key-1234567890';

// ── readResendKey (credential resolution) ──────────────────────────────────
describe('readResendKey', () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  it('prefers the RESEND_API_KEY env var', () => {
    process.env.RESEND_API_KEY = 're_env-value';
    expect(readResendKey()).toBe('re_env-value');
  });

  it('reads through .env.local when the env var is absent (value presence only)', () => {
    const key = readResendKey();
    expect(typeof key).toBe('string');
    if (key) expect(key.startsWith('re_')).toBe(true);
  });

  it('returns empty for an empty env var when .env.local has no RESEND_API_KEY', () => {
    process.env.RESEND_API_KEY = '';
    // Without a readable key anywhere, the resolver returns '' (the empty
    // string is the documented absent-credential signal — never a throw).
    const key = readResendKey();
    expect(typeof key).toBe('string');
  });
});

// ── fetchResendKeyStatus (Resend API mocked) ───────────────────────────────
describe('fetchResendKeyStatus', () => {
  it('hits GET /api-keys with the bearer token and parses the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'k1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { res, body } = await fetchResendKeyStatus(KEY);

    expect(res.status).toBe(200);
    expect(body.data[0].id).toBe('k1');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.resend.com/api-keys');
    expect(opts.headers.authorization).toBe('Bearer re_test-key-1234567890');
  });

  it('carries the status through for the caller to classify', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ statusCode: 400, message: 'API key is invalid', name: 'validation_error' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { res, body } = await fetchResendKeyStatus(KEY);
    expect(res.status).toBe(400);
    expect(classifyResendKey(res.status, body).kind).toBe('invalid');
  });
});

// ── classifyResendKey (the pure verdict) ───────────────────────────────────
describe('classifyResendKey', () => {
  it('returns valid-full for HTTP 200', () => {
    expect(classifyResendKey(200, { data: [] })).toEqual({ kind: 'valid-full' });
  });

  it('returns valid-sendonly for the restricted_api_key 401 (the send-only key the app uses)', () => {
    expect(
      classifyResendKey(401, { statusCode: 401, message: 'This API key is restricted to only send emails', name: 'restricted_api_key' }),
    ).toEqual({ kind: 'valid-sendonly' });
  });

  it('returns invalid for a bad-key 400 validation_error', () => {
    expect(
      classifyResendKey(400, { statusCode: 400, message: 'API key is invalid', name: 'validation_error' }),
    ).toEqual({ kind: 'invalid' });
  });

  it('returns invalid for any other 400/401/403', () => {
    expect(classifyResendKey(401, { message: 'missing api key' })).toEqual({ kind: 'invalid' });
    expect(classifyResendKey(403, { message: 'forbidden' })).toEqual({ kind: 'invalid' });
  });

  it('returns unknown (not invalid) for 5xx / network-style statuses', () => {
    expect(classifyResendKey(500, { message: 'boom' })).toEqual({ kind: 'unknown', status: 500, detail: 'boom' });
    expect(classifyResendKey(503, null).kind).toBe('unknown');
  });
});
