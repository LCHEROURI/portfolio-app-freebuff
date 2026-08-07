import { describe, expect, it } from 'vitest';
import { buildDailyReportBody, buildWeeklyReportBody, staleScanMarker, type AppState } from './engine';

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const baseRepo = (overrides: Record<string, unknown> = {}) => ({
  id: 'r-1', userId: 'demo-user', projectVersionId: 'v-1', provider: 'github' as const,
  owner: 'LCHEROURI', repositoryName: 'portfolio-app-freebuff',
  repositoryUrl: 'https://github.com/LCHEROURI/portfolio-app-freebuff',
  defaultBranch: 'main', currentBranch: 'main', private: false,
  openPullRequests: 0, openIssues: 0,
  commitsAhead: 0, commitsBehind: 0, hasUncommittedChanges: false, hasUnpushedCommits: false,
  connectionStatus: 'CONNECTED' as const, lastScannedAt: isoDaysAgo(3),
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  ...overrides,
} as const);

const state = (repo: ReturnType<typeof baseRepo>): AppState => ({
  profile: {
    id: 'demo-user', name: 'Command Center', timezone: 'UTC',
    dailyReportEnabled: true, dailyReportTime: '07:00',
    weeklyReportEnabled: true, weeklyReportDay: 1, weeklyReportTime: '07:00',
    defaultStaleDays: 7, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  },
  projects: [{
    id: 'p-1', userId: 'demo-user', name: 'Portfolio', slug: 'portfolio', description: '',
    category: 'app', businessGoal: '', targetCustomer: '', monetizationModel: '',
    priority: 'P1_HIGH' as const, overallStatus: 'BUILDING' as const, overallProgress: 50,
    nextAction: '', archived: false,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    lastActivityAt: new Date().toISOString(),
  }],
  versions: [{
    id: 'v-1', projectId: 'p-1', userId: 'demo-user', versionName: 'Main build',
    builder: 'Codex', model: 'GPT-4o Codex', developmentPlatform: 'Next.js',
    status: 'BUILDING' as const, progress: 50, branch: 'main', isWinner: false, isArchived: false,
    deploymentIds: [], estimatedCost: 0, actualCost: 0, developmentHours: 0,
    lastActivityAt: new Date().toISOString(),
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  }],
  repositories: [repo],
  deployments: [],
  tasks: [],
  evaluations: [],
  activity: [],
});

describe('staleScanMarker', () => {
  it('flags a repo whose scanner facts are older than 24h with unpushed commits', () => {
    const s = state(baseRepo({ hasUnpushedCommits: true, commitsAhead: 3 }));
    const queue = buildDailyReportBody(s);
    expect(queue.body).toContain('⚠ stale scan · 3d ago');
  });

  it('flags a repo with uncommitted changes scanned more than 24h ago', () => {
    const s = state(baseRepo({ hasUncommittedChanges: true }));
    const marker = staleScanMarker(s, { project: s.projects[0], version: s.versions[0], rule: 'UNPUSHED', ruleNumber: 2, severity: 'high', title: 'x', description: 'y' });
    expect(marker).toContain('stale scan');
  });

  it('does NOT flag a scan newer than 24h', () => {
    const s = state(baseRepo({ hasUnpushedCommits: true, lastScannedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() }));
    const marker = staleScanMarker(s, { project: s.projects[0], version: s.versions[0], rule: 'UNPUSHED', ruleNumber: 2, severity: 'high', title: 'x', description: 'y' });
    expect(marker).toBe('');
  });

  it('does NOT flag a repo with no scanner facts (clean scan)', () => {
    const s = state(baseRepo({ lastScannedAt: isoDaysAgo(5) }));
    const marker = staleScanMarker(s, { project: s.projects[0], version: s.versions[0], rule: 'UNPUSHED', ruleNumber: 2, severity: 'high', title: 'x', description: 'y' });
    expect(marker).toBe('');
  });

  it('does NOT flag a repo with no lastScannedAt', () => {
    const s = state(baseRepo({ lastScannedAt: undefined, hasUnpushedCommits: true }));
    const marker = staleScanMarker(s, { project: s.projects[0], version: s.versions[0], rule: 'UNPUSHED', ruleNumber: 2, severity: 'high', title: 'x', description: 'y' });
    expect(marker).toBe('');
  });
});

describe('buildWeeklyReportBody — stale scan in priority queue', () => {
  it('appends the stale-scan marker to the weekly priority queue too', () => {
    const s = state(baseRepo({ hasUnpushedCommits: true, commitsAhead: 3 }));
    const weekly = buildWeeklyReportBody(s);
    expect(weekly.body).toContain('⚠ stale scan · 3d ago');
    expect(weekly.body).toContain('## Priority queue');
  });
});
