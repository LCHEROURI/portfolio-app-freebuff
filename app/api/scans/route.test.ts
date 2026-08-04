import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the small server helper (not the node:fs/promises builtin, which is
// flaky to mock). Same pattern as the cron route test mocking
// @/lib/server/reporting/data. vi.hoisted runs before the mock factory so the
// shared fn is safe from hoisting-order issues.
const { readScansFileMock } = vi.hoisted(() => ({ readScansFileMock: vi.fn() }));
vi.mock('@/lib/server/scans', () => ({
  readScansFile: readScansFileMock,
}));

import { GET } from './route';

const makeRepo = (overrides: Record<string, unknown> = {}) => ({
  id: 'r-1',
  userId: 'demo-user',
  provider: 'github',
  owner: 'LCHEROURI',
  repositoryName: 'portfolio-app-freebuff',
  repositoryUrl: 'https://github.com/LCHEROURI/portfolio-app-freebuff',
  defaultBranch: 'main',
  currentBranch: 'main',
  private: true,
  lastCommitSha: 'abc123',
  lastCommitMessage: 'feat: something',
  lastCommitAt: '2026-08-01T12:00:00.000Z',
  openPullRequests: 0,
  openIssues: 0,
  commitsAhead: 3,
  commitsBehind: 1,
  hasUncommittedChanges: true,
  hasUnpushedCommits: false,
  connectionStatus: 'CONNECTED',
  lastScannedAt: '2026-08-04T06:30:00.000Z',
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-04T06:30:00.000Z',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/scans', () => {
  it('returns one row per repo with lastScannedAt, sorted newest first', async () => {
    readScansFileMock.mockResolvedValue([
      makeRepo({ id: 'r-old', repositoryName: 'old-repo', lastScannedAt: '2026-08-01T06:30:00.000Z' }),
      makeRepo({ repositoryName: 'fresh-repo' }),
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; repos: Array<{ repositoryName: string; lastScannedAt: string }> };

    expect(json.ok).toBe(true);
    expect(json.repos).toHaveLength(2);
    expect(json.repos[0].repositoryName).toBe('fresh-repo');
    expect(json.repos[0].lastScannedAt).toBe('2026-08-04T06:30:00.000Z');
    expect(json.repos[1].repositoryName).toBe('old-repo');
  });

  it('omits rows without a repositoryName (malformed / partial scans)', async () => {
    readScansFileMock.mockResolvedValue([
      makeRepo(),
      { id: 'r-broken', lastScannedAt: '2026-08-04T06:30:00.000Z' }, // no repositoryName
      'not-an-object',
    ]);

    const res = await GET();
    const json = (await res.json()) as { repos: unknown[] };
    expect(json.repos).toHaveLength(1);
  });

  it('returns an empty feed when the scans file is missing or unreadable', async () => {
    readScansFileMock.mockRejectedValue(new Error('ENOENT'));

    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; repos: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.repos).toEqual([]);
  });

  it('returns an empty feed for non-array JSON', async () => {
    readScansFileMock.mockResolvedValue({ not: 'an array' });

    const res = await GET();
    const json = (await res.json()) as { repos: unknown[] };
    expect(json.repos).toEqual([]);
  });
});
