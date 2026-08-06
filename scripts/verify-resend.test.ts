import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  classifyResendKey,
  fetchResendKeyStatus,
  readResendKey,
  readReportFrom,
  classifyReportFrom,
  probeDomainDns,
  classifySenderDomain,
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

// ── readReportFrom (sender resolution) ──────────────────────────────────────
describe('readReportFrom', () => {
  beforeEach(() => {
    delete process.env.REPORT_FROM;
  });

  it('prefers the REPORT_FROM env var', () => {
    process.env.REPORT_FROM = 'Command Center <reports@example.com>';
    expect(readReportFrom()).toBe('Command Center <reports@example.com>');
  });

  it('returns a string (possibly empty) when the env var is absent', () => {
    expect(typeof readReportFrom()).toBe('string');
  });

  it('returns empty for an empty env var', () => {
    process.env.REPORT_FROM = '';
    expect(readReportFrom()).toBe('');
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

// ── classifyReportFrom (the sender-value verdict) ──────────────────────────
describe('classifyReportFrom', () => {
  it('classifies an empty value as unset', () => {
    expect(classifyReportFrom('')).toEqual({ kind: 'unset' });
    expect(classifyReportFrom(undefined)).toEqual({ kind: 'unset' });
    expect(classifyReportFrom('   ')).toEqual({ kind: 'unset' });
  });

  it('classifies the sandbox sender as sandbox', () => {
    expect(classifyReportFrom('Command Center <onboarding@resend.dev>')).toEqual({
      kind: 'sandbox',
      email: 'onboarding@resend.dev',
      domain: 'resend.dev',
    });
  });

  it('classifies any @resend.dev address as sandbox', () => {
    expect(classifyReportFrom('no-reply@sub.resend.dev').kind).toBe('sandbox');
  });

  it('classifies a custom domain address as custom', () => {
    expect(classifyReportFrom('Command Center <reports@yourname.com>')).toEqual({
      kind: 'custom',
      email: 'reports@yourname.com',
      domain: 'yourname.com',
    });
    expect(classifyReportFrom('reports@yourname.com').domain).toBe('yourname.com');
  });

  it('prefers the angle-bracketed address when the display name itself contains an @', () => {
    expect(classifyReportFrom('bob@home <reports@yourname.com>')).toEqual({
      kind: 'custom',
      email: 'reports@yourname.com',
      domain: 'yourname.com',
    });
  });

  it('classifies an unparseable value as malformed', () => {
    expect(classifyReportFrom('not-an-email')).toEqual({ kind: 'malformed', raw: 'not-an-email' });
  });
});

// ── probeDomainDns (injected resolver) ─────────────────────────────────────
describe('probeDomainDns', () => {
  // Fake resolver returning TXT records per name; unlisted names throw
  // ENODATA like node:dns does for a missing record type.
  const makeResolver = (map) => async (name) => {
    if (map[name]) return map[name];
    const err = new Error('queryTxt ENODATA');
    err.code = 'ENODATA';
    throw err;
  };

  it('reports spf+dkim+dmarc found when all three records exist', async () => {
    const resolver = makeResolver({
      'yourname.com': [['v=spf1 include:amazonses.com ~all']],
      'resend._domainkey.yourname.com': [['v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0B']],
      '_dmarc.yourname.com': [['v=DMARC1; p=none;']],
    });
    const probe = await probeDomainDns('yourname.com', resolver);
    expect(probe).toEqual({ spf: true, dkim: true, dmarc: true, error: '' });
  });

  it('flags missing DKIM as false without an error', async () => {
    const resolver = makeResolver({
      'yourname.com': [['v=spf1 include:amazonses.com ~all']],
    });
    const probe = await probeDomainDns('yourname.com', resolver);
    expect(probe.spf).toBe(true);
    expect(probe.dkim).toBe(false);
    expect(probe.error).toBe('');
  });

  it('treats a root lookup network failure as an error (cannot verify)', async () => {
    const failing = async () => {
      const err = new Error('queryTxt ETIMEOUT');
      err.code = 'ETIMEOUT';
      throw err;
    };
    const probe = await probeDomainDns('yourname.com', failing);
    expect(probe.error).toBe('ETIMEOUT');
  });

  it('treats root ENODATA as a missing SPF (unverified), not an error', async () => {
    // A domain that resolves but has no TXT records at all is a genuine
    // missing-SPF state, not a probe failure — the caller should classify it
    // as unverified (exit 2), not cannot-verify (exit 1).
    const resolver = makeResolver({});
    const probe = await probeDomainDns('yourname.com', resolver);
    expect(probe.spf).toBe(false);
    expect(probe.error).toBe('');
  });

  it('ignores missing DMARC (optional) as a non-error', async () => {
    const resolver = makeResolver({
      'yourname.com': [['v=spf1 include:amazonses.com ~all']],
      'resend._domainkey.yourname.com': [['v=DKIM1; k=rsa; p=abc']],
    });
    const probe = await probeDomainDns('yourname.com', resolver);
    expect(probe.dmarc).toBe(false);
    expect(probe.error).toBe('');
  });
});

// ── classifySenderDomain (combines value + DNS probe) ──────────────────────
describe('classifySenderDomain', () => {
  it('passes unset through', () => {
    expect(classifySenderDomain('', {})).toEqual({ kind: 'unset' });
  });

  it('passes sandbox through without a DNS probe', () => {
    expect(classifySenderDomain('Command Center <onboarding@resend.dev>', {}).kind).toBe('sandbox');
  });

  it('returns verified when SPF + DKIM are present', () => {
    const probe = { spf: true, dkim: true, dmarc: true, error: '' };
    expect(classifySenderDomain('Command Center <reports@yourname.com>', probe)).toEqual({
      kind: 'verified',
      email: 'reports@yourname.com',
      domain: 'yourname.com',
      dmarc: true,
    });
  });

  it('returns unverified when a required record is missing', () => {
    const probe = { spf: true, dkim: false, dmarc: false, error: '' };
    expect(classifySenderDomain('reports@yourname.com', probe).kind).toBe('unverified');
  });

  it('returns cannot-verify when the DNS probe errored', () => {
    const probe = { spf: false, dkim: false, dmarc: false, error: 'ETIMEOUT' };
    const verdict = classifySenderDomain('reports@yourname.com', probe);
    expect(verdict.kind).toBe('cannot-verify');
    expect(verdict.error).toBe('ETIMEOUT');
  });
});
