import { describe, expect, it } from 'vitest';

import { buildDailyReportBody, buildWeeklyReportBody, scanFreshnessSummary, type AppState } from './engine';
import type { Repository } from '@/types';

const now = Date.now();

const repo = (overrides: Partial<Repository> & { id: string; repositoryName: string; lastScannedAt: string }): Repository => ({
  userId: 'demo-user',
  provider: 'github',
  owner: 'LCHEROURI',
  repositoryUrl: `https://github.com/LCHEROURI/${overrides.repositoryName}`,
  defaultBranch: 'main',
  currentBranch: 'main',
  private: true,
  openPullRequests: 0,
  openIssues: 0,
  commitsAhead: 0,
  commitsBehind: 0,
  hasUncommittedChanges: false,
  hasUnpushedCommits: false,
  connectionStatus: 'CONNECTED',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  ...overrides,
});

const stateWithRepos = (repositories: Repository[]): AppState => ({
  profile: {
    id: 'demo-user', name: 'Demo', email: 'demo@local', timezone: 'UTC',
    dailyReportEnabled: true, dailyReportTime: '07:00',
    weeklyReportEnabled: true, weeklyReportDay: 1, weeklyReportTime: '07:00',
    defaultStaleDays: 7,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  },
  projects: [],
  versions: [],
  repositories,
  deployments: [],
  tasks: [],
  evaluations: [],
  activity: [],
});

describe('scanFreshnessSummary', () => {
  it('returns zero counts when no repo has a scan', () => {
    const s = scanFreshnessSummary(stateWithRepos([
      repo({ id: 'r-1', repositoryName: 'no-scan', lastScannedAt: '' }),
    ]));
    expect(s.scannedCount).toBe(0);
    expect(s.staleCount).toBe(0);
    expect(s.newest).toBeUndefined();
  });

  it('flags the newest and oldest lastScannedAt across repos', () => {
    const s = scanFreshnessSummary(stateWithRepos([
      repo({ id: 'r-old', repositoryName: 'old-repo', lastScannedAt: new Date(now - 5 * 86_400_000).toISOString() }),
      repo({ id: 'r-new', repositoryName: 'new-repo', lastScannedAt: new Date(now - 60 * 60_000).toISOString() }),
      repo({ id: 'r-mid', repositoryName: 'mid-repo', lastScannedAt: new Date(now - 2 * 86_400_000).toISOString() }),
    ]));
    expect(s.scannedCount).toBe(3);
    expect(s.newest?.repositoryName).toBe('new-repo');
    expect(s.newestStale).toBe(false);
    expect(s.oldest?.repositoryName).toBe('old-repo');
    expect(s.oldestStale).toBe(true);
    // Two of the three scans are older than 24h.
    expect(s.staleCount).toBe(2);
  });
});

describe('buildDailyReportBody — Local scan freshness section', () => {
  it('emits the newest/oldest rows and stale count when scans exist', () => {
    const { body } = buildDailyReportBody(stateWithRepos([
      repo({ id: 'r-old', repositoryName: 'old-repo', lastScannedAt: new Date(now - 5 * 86_400_000).toISOString() }),
      repo({ id: 'r-new', repositoryName: 'new-repo', lastScannedAt: new Date(now - 60 * 60_000).toISOString() }),
    ]));
    expect(body).toContain('## Local scan freshness');
    expect(body).toContain('Newest: **LCHEROURI/new-repo** — scanned 1h ago');
    expect(body).toContain('Oldest: **LCHEROURI/old-repo** — scanned 5d ago ⚠ stale');
    expect(body).toContain('1 of 2 repo(s) have a scan older than 24h.');
  });

  it('emits the no-scans hint when the feed is empty', () => {
    const { body } = buildDailyReportBody(stateWithRepos([]));
    expect(body).toContain('## Local scan freshness');
    expect(body).toContain('No local scans yet — run `npm run scan:all` to seed the feed.');
  });
});

describe('buildWeeklyReportBody — Local scan freshness section', () => {
  it('carries the same newest/oldest/stale header as the daily email', () => {
    const { body } = buildWeeklyReportBody(stateWithRepos([
      repo({ id: 'r-old', repositoryName: 'old-repo', lastScannedAt: new Date(now - 5 * 86_400_000).toISOString() }),
      repo({ id: 'r-new', repositoryName: 'new-repo', lastScannedAt: new Date(now - 60 * 60_000).toISOString() }),
    ]));
    expect(body).toContain('## Local scan freshness');
    expect(body).toContain('Newest: **LCHEROURI/new-repo** — scanned 1h ago');
    expect(body).toContain('Oldest: **LCHEROURI/old-repo** — scanned 5d ago ⚠ stale');
    expect(body).toContain('1 of 2 repo(s) have a scan older than 24h.');
  });

  it('emits the no-scans hint when the weekly feed is empty', () => {
    const { body } = buildWeeklyReportBody(stateWithRepos([]));
    expect(body).toContain('## Local scan freshness');
    expect(body).toContain('No local scans yet — run `npm run scan:all` to seed the feed.');
  });
});
