import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkIntegrations } from './status';

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
      authorizedDomains: ['localhost', 'portfolio-app-freebuff.firebaseapp.com'],
    });
  }
  // GitHub /rate_limit is always pinged; return a healthy body.
  if (url.includes('api.github.com')) {
    return jsonResponse({ resources: { core: { remaining: 10, limit: 60 } } });
  }
  return jsonResponse({});
});

const stubClientEnv = () => {
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'test-key');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'portfolio-app-freebuff');
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

describe('checkIntegrations — authorized-domains override', () => {
  it('validates the request origin by default', async () => {
    stubClientEnv();
    vi.stubGlobal('fetch', fetchMock);

    const fb = await firebaseStatus('http://localhost:3000');
    expect(fb.authDomains).toEqual({
      ok: true,
      origin: 'localhost',
      href: 'https://console.firebase.google.com/project/portfolio-app-freebuff/authentication/settings',
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
      href: 'https://console.firebase.google.com/project/portfolio-app-freebuff/authentication/settings',
    });
  });

  it('skips the domain check when the client SDK is not configured', async () => {
    vi.stubGlobal('fetch', fetchMock);

    const fb = await firebaseStatus('http://localhost:3000');
    expect(fb.authDomains).toBeUndefined();
  });
});
