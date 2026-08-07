import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionStatusWidget } from './ConnectionStatusWidget';
import type { IntegrationStatus } from '@/lib/liveData';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// The widget's nav row is a next/link; render it as a plain anchor so the
// test doesn't need an app-router context.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// The widget only needs the store's userId; keep the test hermetic by stubbing
// the store instead of mounting StoreProvider.
vi.mock('@/lib/store', () => ({
  useStore: () => ({ userId: 'e2e-user' }),
}));

// liveData's call helper reads the auth token from Firebase; stubbing the
// module keeps the firebase SDK import chain out of the test entirely.
vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: () => false,
  readFirebaseConfig: () => null,
  getFirebaseApp: () => null,
  getFirebaseAuth: () => null,
  getFirestoreDb: () => null,
  getFirebaseFunctions: () => null,
  getUserId: async () => 'e2e-user',
  subscribeToUser: () => () => {},
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const healthy = (id: string, name: string, envVars: string[]): IntegrationStatus => ({
  id,
  name,
  enabled: true,
  configured: true,
  env: envVars.map((n) => ({ name: n, set: true, required: true })),
  endpoint: { ok: true, status: 200, ms: 40, detail: 'ok' },
});

const baseline = (): IntegrationStatus[] => [
  healthy('firestore', 'Firestore', ['FIREBASE_SERVICE_ACCOUNT', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID']),
  healthy('github', 'GitHub', ['GITHUB_TOKEN', 'NEXT_PUBLIC_LIVE_REPOS']),
  healthy('vercel', 'Vercel', ['VERCEL_TOKEN', 'NEXT_PUBLIC_LIVE_DEPLOYMENTS']),
  healthy('firebase', 'Firebase', ['NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID']),
  healthy('automation', 'Automation Engine', ['CRON_SECRET']),
];

// GitHub loses its token AND its endpoint check fails — the realistic state of
// a missing GITHUB_TOKEN, and the only way the widget's needsSetup gate opens
// (a bare env-var flip with a healthy endpoint stays levelOf 'ok').
const githubBroken = (): IntegrationStatus[] =>
  baseline().map((s) =>
    s.id === 'github'
      ? {
          ...s,
          env: s.env.map((v) => (v.name === 'GITHUB_TOKEN' ? { ...v, set: false } : v)),
          endpoint: { ok: false, status: 503, ms: 2400, detail: 'Service Unavailable' },
        }
      : s,
  );

// ─── Fetch stub: one queued /api/status body per poll ───────────────────────

let queue: IntegrationStatus[][];

const stubStatusFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes('/api/status')) {
      throw new Error(`Unexpected fetch in widget status test: ${url}`);
    }
    // Each poll consumes exactly one queued body. Throw when exhausted so an
    // unexpected extra poll fails the test loudly instead of silently serving
    // a baseline that would let stale assertions pass.
    const integrations = queue.shift();
    if (!integrations) {
      throw new Error('Unexpected /api/status poll: response queue exhausted');
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, checkedAt: new Date().toISOString(), integrations }),
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

beforeEach(() => {
  queue = [];
  stubStatusFetch();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// The widget has no refresh button, so its second poll is driven by the 60s
// polling interval. Fake timers fire it deterministically; the fetch mock
// resolves on microtasks, which act() flushes.
const POLL_MS = 60_000;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ConnectionStatusWidget — mocked /api/status E2E', () => {
  it('shows no per-var links or copy buttons while every integration is healthy', async () => {
    queue = [baseline()];
    render(<ConnectionStatusWidget />);
    await act(async () => {});
    await act(async () => {});

    expect(screen.getByLabelText('Integration status — 5/5 connected')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Get GITHUB_TOKEN — GitHub token page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy GITHUB_TOKEN=<github_pat_...>' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Env settings' })).toBeNull();
  });

  it('surfaces the new missing var via per-var link + copy button after a poll', async () => {
    queue = [baseline(), githubBroken()];
    render(<ConnectionStatusWidget />);
    await act(async () => {});
    await act(async () => {});

    // Healthy baseline first — no missing-var affordances yet.
    expect(screen.getByLabelText('Integration status — 5/5 connected')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Get GITHUB_TOKEN — GitHub token page' })).toBeNull();

    // Fire the 60s polling interval → second poll serves the broken GitHub.
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });

    // Summary flips to one issue.
    expect(screen.getByLabelText('Integration status — 1 issue')).toBeInTheDocument();

    // The per-var console deep-link appears with the exact GitHub token URL…
    const link = screen.getByRole('link', { name: 'Get GITHUB_TOKEN — GitHub token page' });
    expect(link).toHaveAttribute('href', 'https://github.com/settings/personal-access-tokens/new');

    // …the copy affordance for the .env.example line sits beside it…
    expect(screen.getByRole('button', { name: 'Copy GITHUB_TOKEN=<github_pat_...>' })).toBeInTheDocument();

    // …and the one-click Vercel env-settings link is present too.
    expect(screen.getByRole('link', { name: 'Env settings' })).toBeInTheDocument();
  });
});
