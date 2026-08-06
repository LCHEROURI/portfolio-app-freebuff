import { describe, expect, it } from 'vitest';
import {
  actionsVerdict,
  findActionsComponent,
  outageGuidance,
  parseOverallStatus,
} from './gha-status.mjs';

// ── parseOverallStatus ───────────────────────────────────────────────────────
describe('parseOverallStatus', () => {
  it('extracts indicator and description from the status body', () => {
    expect(
      parseOverallStatus({ status: { indicator: 'major', description: 'Partial System Outage' } }),
    ).toEqual({ indicator: 'major', description: 'Partial System Outage' });
  });

  it('handles a missing description', () => {
    expect(parseOverallStatus({ status: { indicator: 'none' } })).toEqual({
      indicator: 'none',
      description: '',
    });
  });

  it('tolerates a malformed or absent body', () => {
    expect(parseOverallStatus(null)).toEqual({ indicator: 'unknown', description: '' });
    expect(parseOverallStatus({})).toEqual({ indicator: 'unknown', description: '' });
    expect(parseOverallStatus('nope')).toEqual({ indicator: 'unknown', description: '' });
  });
});

// ── findActionsComponent ─────────────────────────────────────────────────────
describe('findActionsComponent', () => {
  it('finds the Actions component by exact name', () => {
    const body = {
      components: [
        { name: 'GitHub Actions', status: 'operational' },
        { name: 'Actions', status: 'major_outage' },
        { name: 'API Requests', status: 'operational' },
      ],
    };
    expect(findActionsComponent(body)).toEqual({ name: 'Actions', status: 'major_outage' });
  });

  it('returns null when Actions is absent', () => {
    expect(findActionsComponent({ components: [{ name: 'API Requests', status: 'operational' }] })).toBeNull();
    expect(findActionsComponent(null)).toBeNull();
    expect(findActionsComponent({})).toBeNull();
  });
});

// ── actionsVerdict ───────────────────────────────────────────────────────────
describe('actionsVerdict', () => {
  it('classifies major and partial outages as outage', () => {
    expect(actionsVerdict('major_outage')).toBe('outage');
    expect(actionsVerdict('partial_outage')).toBe('outage');
  });

  it('classifies degraded performance as degraded', () => {
    expect(actionsVerdict('degraded_performance')).toBe('degraded');
  });

  it('classifies operational as operational', () => {
    expect(actionsVerdict('operational')).toBe('operational');
  });

  it('treats unknown or missing statuses as unknown', () => {
    expect(actionsVerdict(undefined)).toBe('unknown');
    expect(actionsVerdict('weird-status')).toBe('unknown');
  });
});

// ── outageGuidance ───────────────────────────────────────────────────────────
describe('outageGuidance', () => {
  it('embeds the three-tell signature', () => {
    const text = outageGuidance();
    expect(text).toContain('Set up job');
    expect(text).toContain('Service Unavailable');
    expect(text).toContain('Failed to resolve action download info');
    expect(text).toContain('stuck queued');
  });

  it('embeds the exact recovery steps', () => {
    const text = outageGuidance();
    expect(text).toContain('gh run rerun <run-id>');
    expect(text).toContain('gh run rerun <run-id> --failed');
    expect(text).toContain('Never redeploy');
  });

  it('is never empty (the whole point: guidance is always available)', () => {
    expect(outageGuidance().length).toBeGreaterThan(100);
  });
});
