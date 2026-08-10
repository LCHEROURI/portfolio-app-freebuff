import { describe, expect, it } from 'vitest';
import { buildExportPayload, exportFileName, EXPORT_APP, EXPORT_VERSION } from './exportData';
import type { Project, Report } from '@/types';

const empty = {
  profile: null,
  projects: [],
  versions: [],
  repositories: [],
  deployments: [],
  tasks: [],
  evaluations: [],
  activity: [],
  reports: [],
};

describe('exportData — payload shape', () => {
  it('builds a versioned payload carrying the owner id and exportedAt', () => {
    const payload = buildExportPayload('u-1', empty, new Date('2026-08-10T12:00:00Z'));
    expect(payload.app).toBe(EXPORT_APP);
    expect(payload.version).toBe(EXPORT_VERSION);
    expect(payload.userId).toBe('u-1');
    expect(payload.exportedAt).toBe('2026-08-10T12:00:00.000Z');
    expect(payload.profile).toBeNull();
    // Every collection key is present so the shape never changes silently.
    expect(Object.keys(payload).sort()).toEqual([
      'activity', 'app', 'deployments', 'evaluations', 'exportedAt',
      'profile', 'projects', 'reports', 'repositories', 'tasks',
      'userId', 'version', 'versions',
    ].sort());
  });

  it('passes the per-collection data through untouched', () => {
    const payload = buildExportPayload('u-1', {
      ...empty,
      projects: [{ id: 'p-1', userId: 'u-1' } as Project],
      reports: [{
        id: 'r-1', userId: 'u-1', kind: 'daily', title: 'D', body: 'b',
        attentionCount: 0, createdAt: 'x',
      } as Report],
    }, new Date(0));
    expect(payload.projects).toEqual([{ id: 'p-1', userId: 'u-1' }]);
    expect(payload.reports).toHaveLength(1);
  });
});

describe('exportData — filename', () => {
  it('scopes the filename to the UTC date', () => {
    expect(exportFileName(new Date('2026-08-10T23:59:59Z'))).toBe('freebuff-export-2026-08-10.json');
    expect(exportFileName(new Date('2026-01-02T00:00:00Z'))).toBe('freebuff-export-2026-01-02.json');
  });
});
