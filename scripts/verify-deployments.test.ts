import { describe, expect, it } from 'vitest';

import { classifyFeed } from './verify-deployments.mjs';

const row = (provider, healthStatus) => ({ provider, healthStatus, deploymentUrl: `https://${provider}.example` });

// ── classifyFeed (the pure provider/health bucketing) ────────────────────────
describe('classifyFeed', () => {
  it('buckets firebase and apphosting rows with HEALTHY counts', () => {
    const rows = [
      row('firebase', 'HEALTHY'),
      row('firebase', 'FAILED'),
      row('apphosting', 'HEALTHY'),
      row('apphosting', 'HEALTHY'),
      row('apphosting', 'DEGRADED'),
    ];
    const c = classifyFeed(rows);
    expect(c.firebase).toHaveLength(2);
    expect(c.firebaseHealthy).toHaveLength(1);
    expect(c.apphosting).toHaveLength(3);
    expect(c.apphostingHealthy).toHaveLength(2);
  });

  it('treats only HEALTHY as healthy — FAILED / DEGRADED / UNKNOWN do not count', () => {
    const rows = [
      row('firebase', 'FAILED'),
      row('firebase', 'DEGRADED'),
      row('firebase', 'UNKNOWN'),
      row('apphosting', 'UNKNOWN'),
    ];
    const c = classifyFeed(rows);
    expect(c.firebase).toHaveLength(3);
    expect(c.firebaseHealthy).toHaveLength(0);
    expect(c.apphostingHealthy).toHaveLength(0);
  });

  it('returns empty buckets for an empty or null feed', () => {
    expect(classifyFeed([])).toEqual({ firebase: [], firebaseHealthy: [], apphosting: [], apphostingHealthy: [] });
    expect(classifyFeed(null)).toEqual({ firebase: [], firebaseHealthy: [], apphosting: [], apphostingHealthy: [] });
    expect(classifyFeed(undefined)).toEqual({ firebase: [], firebaseHealthy: [], apphosting: [], apphostingHealthy: [] });
  });

  it('ignores unknown providers and null entries', () => {
    const rows = [row('github', 'HEALTHY'), null, undefined, row('firebase', 'HEALTHY')];
    const c = classifyFeed(rows);
    expect(c.firebase).toHaveLength(1);
    expect(c.firebaseHealthy).toHaveLength(1);
    expect(c.apphosting).toHaveLength(0);
  });

  it('keeps the original row shape so the caller can read URLs / status', () => {
    const rows = [row('firebase', 'HEALTHY')];
    const c = classifyFeed(rows);
    expect(c.firebaseHealthy[0]).toEqual({
      provider: 'firebase',
      healthStatus: 'HEALTHY',
      deploymentUrl: 'https://firebase.example',
    });
  });
});
