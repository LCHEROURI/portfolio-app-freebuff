import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { LastScanStrip } from './LastScanStrip';

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'r-1',
  owner: 'LCHEROURI',
  repositoryName: 'portfolio-app-freebuff',
  currentBranch: 'main',
  lastScannedAt: new Date().toISOString(),
  hasUncommittedChanges: false,
  hasUnpushedCommits: false,
  commitsAhead: 0,
  commitsBehind: 0,
  ...overrides,
});

const stubScansFetch = (repos: unknown[]) => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, repos }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LastScanStrip', () => {
  it('shows newest and oldest lastScannedAt with the fresh badge', async () => {
    const now = Date.now();
    const fresh = makeRow({ id: 'r-fresh', repositoryName: 'fresh-repo', lastScannedAt: new Date(now - 60 * 60_000).toISOString() });
    const older = makeRow({ id: 'r-old', repositoryName: 'old-repo', lastScannedAt: new Date(now - 5 * 86_400_000).toISOString() });
    stubScansFetch([older, fresh]);

    render(<LastScanStrip />);
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(screen.getByText('LCHEROURI/fresh-repo')).toBeInTheDocument();
    expect(screen.getByText('LCHEROURI/old-repo')).toBeInTheDocument();
    // Fresh scan → basil 'scanned …' badge; old scan → turmeric 'stale scan'.
    expect(screen.getByText(/scanned 1h ago/)).toBeInTheDocument();
    expect(screen.getByText(/stale scan · 5d ago/)).toBeInTheDocument();
    // One stale repo → the count badge appears.
    expect(screen.getByText('1 stale')).toBeInTheDocument();
    expect(screen.getByText('2 repos')).toBeInTheDocument();
  });

  it('highlights every repo stale and shows the total count', async () => {
    const now = Date.now();
    const a = makeRow({ id: 'r-a', repositoryName: 'a', lastScannedAt: new Date(now - 2 * 86_400_000).toISOString() });
    const b = makeRow({ id: 'r-b', repositoryName: 'b', lastScannedAt: new Date(now - 3 * 86_400_000).toISOString() });
    stubScansFetch([a, b]);

    render(<LastScanStrip />);
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(screen.getAllByText(/stale scan ·/)).toHaveLength(2);
    expect(screen.getByText('2 stale')).toBeInTheDocument();
  });

  it('renders the empty state when there are no scans yet', async () => {
    stubScansFetch([]);

    render(<LastScanStrip />);
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(screen.getByText(/No local scans yet/)).toBeInTheDocument();
    expect(screen.getByText('npm run scan:all')).toBeInTheDocument();
  });

  it('degrades to the empty state when /api/scans is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

    render(<LastScanStrip />);
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(screen.getByText(/No local scans yet/)).toBeInTheDocument();
  });

  it('refreshes the feed when Refresh is clicked', async () => {
    const now = Date.now();
    const fetchMock = stubScansFetch([
      makeRow({ id: 'r-a', repositoryName: 'a', lastScannedAt: new Date(now).toISOString() }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();

    render(<LastScanStrip />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh local scan freshness' }));
    // waitFor would spin on the fake-timer clock, so settle the promise chain
    // the same way the mount assertions do.
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/scans', expect.objectContaining({ cache: 'no-store' }));
  });
});
