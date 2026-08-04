import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import IntegrationsPage from './page';
import type { IntegrationStatus } from '@/lib/liveData';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// The panel only needs the store's userId; keep the test hermetic by stubbing
// the store instead of mounting StoreProvider (which loads Firestore/demo data).
vi.mock('@/lib/store', () => ({
  useStore: () => ({ userId: 'e2e-user' }),
}));

// The panel never talks to Firebase directly, and stubbing the module keeps the
// firebase SDK import chain out of the test entirely. (The page's default
// export renders the live ConnectionStatusPanel plus static setup cards; a
// page file must not carry named exports, so the test renders the whole page.)
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
  healthy('supabase', 'Supabase', ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_LIVE_TASKS']),
  healthy('github', 'GitHub', ['GITHUB_TOKEN', 'NEXT_PUBLIC_LIVE_REPOS']),
  healthy('vercel', 'Vercel', ['VERCEL_TOKEN', 'NEXT_PUBLIC_LIVE_DEPLOYMENTS']),
  healthy('firebase', 'Firebase', ['NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID']),
  healthy('automation', 'Automation Engine', ['CRON_SECRET', 'RESEND_API_KEY', 'REPORT_EMAIL']),
];

/** Apply per-id endpoint overrides onto the baseline (empty → unchanged). */
const flipped = (overrides: Record<string, IntegrationStatus['endpoint']> = {}): IntegrationStatus[] =>
  baseline().map((s) => (overrides[s.id] ? { ...s, endpoint: overrides[s.id] } : s));

const gh503 = { ok: false, status: 503, ms: 2400, detail: 'Service Unavailable' };

/** Unset the named env vars on one integration; everything else stays as-is. */
const withEnvUnset = (id: string, names: string[]): IntegrationStatus[] =>
  baseline().map((s) =>
    s.id === id
      ? { ...s, env: s.env.map((v) => (names.includes(v.name) ? { ...v, set: false } : v)) }
      : s,
  );

// ─── Fetch stub: one queued /api/status body per poll ───────────────────────

let queue: IntegrationStatus[][];

const stubStatusFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes('/api/status')) {
      throw new Error(`Unexpected fetch in status-flip test: ${url}`);
    }
    // Each poll consumes exactly one queued body. Throw when exhausted so an
    // unexpected extra poll fails the test loudly instead of silently serving
    // a baseline that would let stale badge assertions pass.
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_ENABLE_SIMULATIONS;
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const cardOf = (name: string): HTMLElement => {
  const card = screen.getByRole('heading', { name }).closest('div.relative');
  if (!card) throw new Error(`No card found for ${name}`);
  return card as HTMLElement;
};

const refresh = async () => {
  const btn = screen.getByRole('button', { name: 'Refresh connection status' });
  await waitFor(() => expect(btn).not.toBeDisabled());
  fireEvent.click(btn);
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('IntegrationsPage — mocked /api/status E2E', () => {
  it('shows no Updated badge on the very first check (no previous snapshot)', async () => {
    queue = [baseline()];
    render(<IntegrationsPage />);
    await screen.findByRole('heading', { name: 'GitHub' });
    expect(screen.queryByLabelText(/^Updated —/)).toBeNull();
  });

  it('badges the flipped GitHub card after a second poll and lists exactly what changed', async () => {
    queue = [baseline(), flipped({ github: gh503 })];
    render(<IntegrationsPage />);
    await screen.findByRole('heading', { name: 'GitHub' });
    expect(screen.queryByLabelText(/^Updated —/)).toBeNull();

    await refresh();

    const badge = await screen.findByLabelText(/^Updated —/);
    expect(badge).toHaveAttribute(
      'aria-label',
      'Updated — Endpoint OK → error, HTTP 200 → 503, Latency 40ms → 2400ms',
    );

    // The badge sits on the GitHub card — and only there.
    const githubCard = cardOf('GitHub');
    expect(within(githubCard).getByLabelText(/^Updated —/)).toBeInTheDocument();
    const supabaseCard = cardOf('Supabase');
    expect(within(supabaseCard).queryByLabelText(/^Updated —/)).toBeNull();

    // The what-changed tooltip content is in the DOM (aria-hidden, so found by text).
    expect(within(githubCard).getByText('Endpoint OK → error')).toBeInTheDocument();
    expect(within(githubCard).getByText('HTTP 200 → 503')).toBeInTheDocument();
    expect(within(githubCard).getByText('Latency 40ms → 2400ms')).toBeInTheDocument();

    // Summary line reflects the single flip.
    expect(await screen.findByText(/1 card just updated/)).toBeInTheDocument();
  });

  it('reports a cleared env var in the badge tooltip when a token is unset between polls', async () => {
    queue = [baseline(), withEnvUnset('github', ['GITHUB_TOKEN'])];
    render(<IntegrationsPage />);
    await screen.findByRole('heading', { name: 'GitHub' });
    expect(screen.queryByLabelText(/^Updated —/)).toBeNull();

    await refresh();

    const badge = await screen.findByLabelText(/^Updated —/);
    expect(badge).toHaveAttribute('aria-label', 'Updated — GITHUB_TOKEN cleared');

    // The badge sits on the GitHub card — and only there.
    const githubCard = cardOf('GitHub');
    expect(within(githubCard).getByLabelText(/^Updated —/)).toBeInTheDocument();
    const supabaseCard = cardOf('Supabase');
    expect(within(supabaseCard).queryByLabelText(/^Updated —/)).toBeNull();

    // The what-changed tooltip carries the env-var description.
    expect(within(githubCard).getByText('GITHUB_TOKEN cleared')).toBeInTheDocument();

    // Summary line reflects the single flip.
    expect(await screen.findByText(/1 card just updated/)).toBeInTheDocument();
  });

  it('renders a simulate-flip control when the dev flag is on, and it drives the badge through the real polling hook', async () => {
    // Dev-only flag: shows the simulate button; the wrapper flips GitHub on
    // the NEXT /api/status poll after the button is clicked.
    process.env.NEXT_PUBLIC_ENABLE_SIMULATIONS = '1';
    // Three polls: initial baseline, armed flip, then disarm reversal.
    queue = [baseline(), baseline(), baseline()];
    render(<IntegrationsPage />);
    await screen.findByRole('heading', { name: 'GitHub' });
    expect(screen.queryByLabelText(/^Updated —/)).toBeNull();

    const simulate = screen.getByRole('button', { name: 'Simulate a status flip' });
    fireEvent.click(simulate);

    // The armed wrapper reports GitHub as down on the forced refresh poll.
    const badge = await screen.findByLabelText(/^Updated —/);
    expect(badge).toHaveAttribute(
      'aria-label',
      'Updated — Endpoint OK → error, HTTP 200 → 503, Latency 40ms → 2400ms',
    );
    expect(within(cardOf('GitHub')).getByLabelText(/^Updated —/)).toBeInTheDocument();
    expect(within(cardOf('Supabase')).queryByLabelText(/^Updated —/)).toBeNull();

    // Toggling off restores real status — which is itself a change, so the
    // badge flips to describe the reversal on the next refresh.
    const stop = screen.getByRole('button', { name: 'Stop simulated outage' });
    fireEvent.click(stop);
    const reversed = await screen.findByLabelText(/^Updated — Endpoint error → OK, HTTP 503 → 200/);
    expect(reversed).toHaveAttribute(
      'aria-label',
      'Updated — Endpoint error → OK, HTTP 503 → 200, Latency 2400ms → 40ms',
    );
    expect(within(cardOf('GitHub')).getByLabelText(/^Updated —/)).toBeInTheDocument();
  });

  it('badges each flipped card when several integrations change in one poll', async () => {
    queue = [
      baseline(),
      flipped({
        github: gh503,
        vercel: { ok: false, status: 500, ms: 3100, detail: 'Internal Server Error' },
      }),
    ];
    render(<IntegrationsPage />);
    await screen.findByRole('heading', { name: 'GitHub' });

    await refresh();

    await screen.findAllByLabelText(/^Updated —/);

    expect(within(cardOf('GitHub')).getByLabelText(/^Updated —/)).toBeInTheDocument();
    expect(within(cardOf('Vercel')).getByLabelText(/^Updated —/)).toBeInTheDocument();
    expect(within(cardOf('Supabase')).queryByLabelText(/^Updated —/)).toBeNull();

    expect(await screen.findByText(/2 cards just updated/)).toBeInTheDocument();
  });
});
