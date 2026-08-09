import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkIntegrations } from './status';

// The admin-API probe needs a service-account token. The real mint signs a
// JWT with the private key — a fake key can't sign — so stub the shared
// credential module: configured reads the same env guards, and minting
// returns a token without touching crypto or the network.
vi.mock('@/lib/server/sa-token.mjs', () => ({
  isServiceAccountConfigured: () =>
    Boolean(
      (process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_PATH) &&
      (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID),
    ),
  mintServiceAccountToken: async () => 'test-token',
  getServiceAccount: () => '',
  getProjectId: () => process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID ?? '',
}));

// ============================================================================
// Firebase authorized-domains check (server side).
// Only the client SDK env vars are needed: the domain list comes from the
// public Identity Toolkit getProjectConfig endpoint (mocked below), and the
// other integrations don't ping when their tokens are unset.
// ============================================================================

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('identitytoolkit.googleapis.com/v1/projects')) {
    return jsonResponse({
      authorizedDomains: ['localhost', 'portfolio-app-freebuff2.firebaseapp.com'],
    });
  }
  // GitHub /rate_limit is always pinged; return a healthy body.
  if (url.includes('api.github.com')) {
    return jsonResponse({ resources: { core: { remaining: 10, limit: 60 } } });
  }
  // Identity Platform admin API: the google.com IdP record (google-idp check).
  if (url.includes('defaultSupportedIdpConfigs/google.com')) {
    return jsonResponse(
      { enabled: true, clientId: '952213217375-abc.apps.googleusercontent.com' },
    );
  }
  return jsonResponse({});
});

const stubClientEnv = () => {
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'test-key');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'portfolio-app-freebuff2');
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const firebaseStatus = async (origin: string, projectOrigin?: string) => {
  // refresh=true clears the module-level ping cache between calls.
  const statuses = await checkIntegrations(true, origin, projectOrigin);
  const fb = statuses.find((s) => s.id === 'firebase');
  if (!fb) throw new Error('firebase status missing');
  return fb;
};

const stubAdminEnv = () => {
  // A minimal-but-well-formed service account JSON is enough for the configured
  // guard + the cachedPing call (the mint itself is mocked above).
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT', JSON.stringify({
    type: 'service_account',
    project_id: 'portfolio-app-freebuff2',
    client_email: 'cron@portfolio-app-freebuff2.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n',
  }));
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'portfolio-app-freebuff2');
  vi.stubEnv('GOOGLE_CLIENT_ID', '952213217375-abc.apps.googleusercontent.com');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'GOCSPX-secret');
};

const googleIdpStatus = async () => {
  const statuses = await checkIntegrations(true);
  const g = statuses.find((s) => s.id === 'google-idp');
  if (!g) throw new Error('google-idp status missing');
  return g;
};

describe('checkIntegrations — Google IdP record probe', () => {
  it('reports the google.com IdP record as healthy when the admin API returns it enabled', async () => {
    stubAdminEnv();
    vi.stubGlobal('fetch', fetchMock);

    const g = await googleIdpStatus();
    expect(g.configured).toBe(true);
    expect(g.endpoint).toEqual({
      ok: true,
      status: 200,
      ms: expect.any(Number),
      detail: 'google.com IdP enabled with a classic web client',
    });
  });

  it('keys configured off the probe, not the wiring vars: healthy record + vars absent from env is still configured', async () => {
    // The wiring vars are consumed once by wire-google-client.mjs and never
    // exist in Vercel runtime — production has a healthy record but no
    // GOOGLE_CLIENT_* env vars. The probe is the real signal.
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT', JSON.stringify({
      type: 'service_account',
      project_id: 'portfolio-app-freebuff2',
      client_email: 'cron@portfolio-app-freebuff2.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n',
    }));
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'portfolio-app-freebuff2');
    vi.stubGlobal('fetch', fetchMock);

    const g = await googleIdpStatus();
    expect(g.configured).toBe(true);
    expect(g.env.every((v) => v.set)).toBe(true);
    expect(g.endpoint).toEqual({
      ok: true,
      status: 200,
      ms: expect.any(Number),
      detail: 'google.com IdP enabled with a classic web client',
    });
    expect(g.note).toContain('verified live');
  });

  it('flags a missing IdP record as a failed endpoint (the Google popup will fail)', async () => {
    stubAdminEnv();
    const missing = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('defaultSupportedIdpConfigs/google.com')) {
        return jsonResponse({ error: { message: 'not found' } }, 404);
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', missing);

    const g = await googleIdpStatus();
    expect(g.endpoint).toEqual({
      ok: false,
      status: 404,
      ms: expect.any(Number),
      detail: 'google.com IdP record missing — Google popup will fail',
    });
    // Even with the wiring vars stubbed in env, a missing record means NOT
    // configured — the probe is the source of truth.
    expect(g.configured).toBe(false);
  });

  it('skips the probe when the service account is not configured', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '952213217375-abc.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'GOCSPX-secret');
    vi.stubGlobal('fetch', fetchMock);

    const g = await googleIdpStatus();
    expect(g.configured).toBe(true);
    expect(g.endpoint).toBeNull();
    expect(g.note).toContain('wire script can patch');
  });

  it('reports not-configured when the wiring vars are unset', async () => {
    vi.stubGlobal('fetch', fetchMock);

    const g = await googleIdpStatus();
    expect(g.configured).toBe(false);
    expect(g.env.every((v) => !v.set)).toBe(true);
    expect(g.endpoint).toBeNull();
  });
});

describe('checkIntegrations — authorized-domains override', () => {
  it('validates the request origin by default', async () => {
    stubClientEnv();
    vi.stubGlobal('fetch', fetchMock);

    const fb = await firebaseStatus('http://localhost:3000');
    expect(fb.authDomains).toEqual({
      ok: true,
      origin: 'localhost',
      href: 'https://console.firebase.google.com/project/portfolio-app-freebuff2/authentication/settings',
    });
  });

  it('prefers a ?project= override origin when provided', async () => {
    stubClientEnv();
    vi.stubGlobal('fetch', fetchMock);

    const fb = await firebaseStatus(
      'http://localhost:3000',
      'https://portfolio-app-freebuff.vercel.app',
    );
    expect(fb.authDomains).toEqual({
      // Not in the mocked authorized list — flagged even though the request
      // itself came from localhost.
      ok: false,
      origin: 'portfolio-app-freebuff.vercel.app',
      href: 'https://console.firebase.google.com/project/portfolio-app-freebuff2/authentication/settings',
    });
  });

  it('skips the domain check when the client SDK is not configured', async () => {
    vi.stubGlobal('fetch', fetchMock);

    const fb = await firebaseStatus('http://localhost:3000');
    expect(fb.authDomains).toBeUndefined();
  });
});

// ── Firestore probe: the health check must hit a REAL Firestore REST method ──
// The bare GET …/documents?pageSize=1 was rejected by Google's frontend with
// a 404 before auth, so the Firestore card showed 'Endpoint error (HTTP 404)'
// even though the data layer worked (the cron reads through the SAME
// :runQuery call). Lock the fixed probe: POST …/documents:runQuery with a
// trivial structured query — HTTP 200 + [] means the DB + service account are
// healthy — and forbid the old invalid URL from returning.
describe('checkIntegrations — Firestore probe (runQuery, not the documents GET)', () => {
  it('reports healthy and pings :runQuery when the service account is configured', async () => {
    stubAdminEnv();
    const calls: Array<{ url: string; method?: string }> = [];
    const firestoreMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method });
      if (url.includes('firestore.googleapis.com')) return jsonResponse([]); // runQuery → []
      if (url.includes('api.github.com')) {
        return jsonResponse({ resources: { core: { remaining: 10, limit: 60 } } });
      }
      if (url.includes('defaultSupportedIdpConfigs/google.com')) {
        return jsonResponse({ enabled: true, clientId: '952213217375-abc.apps.googleusercontent.com' });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', firestoreMock);

    const statuses = await checkIntegrations(true);
    const fs = statuses.find((s) => s.id === 'firestore');
    expect(fs).toBeDefined();
    expect(fs!.endpoint).toEqual({
      ok: true,
      status: 200,
      ms: expect.any(Number),
      detail: 'Service account can read documents',
    });

    const probe = calls.find((c) => c.url.includes('firestore.googleapis.com'));
    expect(probe).toBeDefined();
    expect(probe!.url).toContain('/documents:runQuery');
    expect(probe!.url).not.toContain('/documents?pageSize=1');
    expect(probe!.method).toBe('POST');
  });

  it('reports a 401/403 as lacking access (a failed probe is a real signal)', async () => {
    stubAdminEnv();
    const denied = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('firestore.googleapis.com')) {
        return jsonResponse({ error: { message: 'permission denied' } }, 403);
      }
      if (url.includes('api.github.com')) {
        return jsonResponse({ resources: { core: { remaining: 10, limit: 60 } } });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', denied);

    const statuses = await checkIntegrations(true);
    const fs = statuses.find((s) => s.id === 'firestore');
    expect(fs!.endpoint).toEqual({
      ok: false,
      status: 403,
      ms: expect.any(Number),
      detail: 'Service account lacks access',
    });
  });
});
