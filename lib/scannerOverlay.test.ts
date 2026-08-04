import { describe, expect, it } from 'vitest';
import { mergeScannerOverlay } from './scannerOverlay';
import type { Repository } from '@/types';

const baseRepo = (overrides: Partial<Repository> = {}): Repository => ({
  id: 'r-1', userId: 'demo-user', projectVersionId: 'v-1', provider: 'github',
  owner: 'LCHEROURI', repositoryName: 'portfolio-app-freebuff',
  repositoryUrl: 'https://github.com/LCHEROURI/portfolio-app-freebuff',
  defaultBranch: 'main', currentBranch: 'main', private: false,
  openPullRequests: 0, openIssues: 0,
  commitsAhead: 0, commitsBehind: 0, hasUncommittedChanges: false, hasUnpushedCommits: false,
  connectionStatus: 'CONNECTED', lastScannedAt: new Date(0).toISOString(),
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  ...overrides,
});

describe('mergeScannerOverlay', () => {
  it('overlays unpushed/uncommitted facts from a local scan onto the live repo', () => {
    const live = [baseRepo()];
    const scanned = [baseRepo({
      commitsAhead: 3, hasUnpushedCommits: true, hasUncommittedChanges: true,
      lastScannedAt: '2026-08-04T00:00:00.000Z',
    })];
    const merged = mergeScannerOverlay(live, scanned);
    expect(merged).toHaveLength(1);
    expect(merged[0].hasUnpushedCommits).toBe(true);
    expect(merged[0].hasUncommittedChanges).toBe(true);
    expect(merged[0].commitsAhead).toBe(3);
    // lastScannedAt rides along so the report can say 'scanned just now'.
    expect(merged[0].lastScannedAt).toBe('2026-08-04T00:00:00.000Z');
  });

  it('keeps live commitsAhead when the scan reports no unpushed commits', () => {
    const live = [baseRepo({ commitsAhead: 5 })];
    const scanned = [baseRepo({ commitsAhead: 0, hasUnpushedCommits: false })];
    const merged = mergeScannerOverlay(live, scanned);
    expect(merged[0].commitsAhead).toBe(5);
    expect(merged[0].hasUnpushedCommits).toBe(false);
  });

  it('returns live untouched when there are no scans', () => {
    const live = [baseRepo()];
    const merged = mergeScannerOverlay(live, []);
    expect(merged).toEqual(live);
  });

  it('ignores scans that do not match a live repo (owner/name key)', () => {
    const live = [baseRepo()];
    const scanned = [baseRepo({ repositoryName: 'freebuff-meal' })];
    const merged = mergeScannerOverlay(live, scanned);
    expect(merged).toHaveLength(1);
    expect(merged[0].repositoryName).toBe('portfolio-app-freebuff');
    expect(merged[0].hasUnpushedCommits).toBe(false);
  });
});
