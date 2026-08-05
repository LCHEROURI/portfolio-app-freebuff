import { describe, it, expect } from 'vitest';

import {
  computeChangedIds,
  computeChangedSummaries,
  describeIntegrationChange,
  integrationChanged,
  LATENCY_SPIKE_MS,
} from './integrationDiff';
import type { IntegrationStatus } from './liveData';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const base = (over: Partial<IntegrationStatus> = {}): IntegrationStatus => ({
  id: 'supabase',
  name: 'Supabase',
  enabled: true,
  configured: true,
  env: [
    { name: 'SUPABASE_URL', set: true, required: true },
    { name: 'SUPABASE_SERVICE_ROLE_KEY', set: true, required: true },
    { name: 'NEXT_PUBLIC_LIVE_TASKS', set: true, required: false },
  ],
  endpoint: { ok: true, status: 200, ms: 120, detail: 'Tasks table reachable' },
  ...over,
});

// ─── integrationChanged ─────────────────────────────────────────────────────

describe('integrationChanged', () => {
  it('is false when nothing observable changed', () => {
    expect(integrationChanged(base(), base())).toBe(false);
  });

  it('is false when only the detail string changed (same state)', () => {
    const a = base();
    const b = base({ endpoint: { ok: true, status: 200, ms: 120, detail: 'different wording' } });
    expect(integrationChanged(a, b)).toBe(false);
  });

  it('detects an env var being set', () => {
    const a = base({ env: [{ name: 'GITHUB_TOKEN', set: false, required: true }] });
    const b = base({ env: [{ name: 'GITHUB_TOKEN', set: true, required: true }] });
    expect(integrationChanged(a, b)).toBe(true);
  });

  it('detects a configured flip', () => {
    const a = base();
    const b = base({ configured: false });
    expect(integrationChanged(a, b)).toBe(true);
  });

  it('detects an enabled (live flag) flip', () => {
    const a = base();
    const b = base({ enabled: false });
    expect(integrationChanged(a, b)).toBe(true);
  });

  it('detects an endpoint status flip ok → error', () => {
    const a = base();
    const b = base({ endpoint: { ok: false, status: 503, ms: 90, detail: 'Service Unavailable' } });
    expect(integrationChanged(a, b)).toBe(true);
  });

  it('detects an endpoint status code change', () => {
    const a = base();
    const b = base({ endpoint: { ok: true, status: 201, ms: 120, detail: 'ok' } });
    expect(integrationChanged(a, b)).toBe(true);
  });

  it('detects a latency spike at the threshold', () => {
    const a = base();
    const b = base({ endpoint: { ok: true, status: 200, ms: 120 + LATENCY_SPIKE_MS, detail: 'ok' } });
    expect(integrationChanged(a, b)).toBe(true);
  });

  it('ignores small latency jitter below the threshold', () => {
    const a = base();
    const b = base({ endpoint: { ok: true, status: 200, ms: 125, detail: 'ok' } });
    expect(integrationChanged(a, b)).toBe(false);
  });

  it('detects endpoint appearing (null → ping)', () => {
    const a = base({ endpoint: null });
    const b = base();
    expect(integrationChanged(a, b)).toBe(true);
  });

  it('detects ms going null ↔ non-null (timeout starting/ending)', () => {
    const a = base();
    const b = base({ endpoint: { ok: false, status: null, ms: null, detail: 'Unreachable' } });
    expect(integrationChanged(a, b)).toBe(true);
  });

  it('detects an authorized-domains flip (authorized → not)', () => {
    const a = base({
      authDomains: { ok: true, origin: 'portfolio-app-freebuff.vercel.app', href: 'https://console.firebase.google.com' },
    });
    const b = base({
      authDomains: { ok: false, origin: 'portfolio-app-freebuff.vercel.app', href: 'https://console.firebase.google.com' },
    });
    expect(integrationChanged(a, b)).toBe(true);
  });

  it('detects the check appearing (absent → unauthorized)', () => {
    const a = base({ authDomains: undefined });
    const b = base({
      authDomains: { ok: false, origin: 'portfolio-app-freebuff.vercel.app', href: 'https://console.firebase.google.com' },
    });
    expect(integrationChanged(a, b)).toBe(true);
  });
});

// ─── describeIntegrationChange ─────────────────────────────────────────────

describe('describeIntegrationChange', () => {
  it('returns [] when nothing observable changed', () => {
    expect(describeIntegrationChange(base(), base())).toEqual([]);
  });

  it('ignores a detail-string reword (same state)', () => {
    const a = base();
    const b = base({ endpoint: { ok: true, status: 200, ms: 120, detail: 'different wording' } });
    expect(describeIntegrationChange(a, b)).toEqual([]);
  });

  it('names an env var that got set', () => {
    const a = base({ env: [{ name: 'GITHUB_TOKEN', set: false, required: true }] });
    const b = base({ env: [{ name: 'GITHUB_TOKEN', set: true, required: true }] });
    expect(describeIntegrationChange(a, b)).toEqual(['GITHUB_TOKEN set']);
  });

  it('names an env var that got cleared', () => {
    const a = base({ env: [{ name: 'GITHUB_TOKEN', set: true, required: true }] });
    const b = base({ env: [{ name: 'GITHUB_TOKEN', set: false, required: true }] });
    expect(describeIntegrationChange(a, b)).toEqual(['GITHUB_TOKEN cleared']);
  });

  it('names an env var that was added to the set', () => {
    const a = base({ env: [] });
    const b = base({ env: [{ name: 'GITHUB_TOKEN', set: true, required: true }] });
    expect(describeIntegrationChange(a, b)).toEqual(['GITHUB_TOKEN added']);
  });

  it('names an env var that was removed from the set', () => {
    const a = base({ env: [{ name: 'GITHUB_TOKEN', set: true, required: true }] });
    const b = base({ env: [] });
    expect(describeIntegrationChange(a, b)).toEqual(['GITHUB_TOKEN removed']);
  });

  it('describes a configured flip', () => {
    expect(describeIntegrationChange(base(), base({ configured: false }))).toEqual([
      'No longer configured',
    ]);
  });

  it('describes a live-flag flip', () => {
    expect(describeIntegrationChange(base(), base({ enabled: false }))).toEqual([
      'Live flag turned off',
    ]);
  });

  it('describes an endpoint status flip with both codes', () => {
    const a = base();
    const b = base({ endpoint: { ok: false, status: 503, ms: 90, detail: 'Service Unavailable' } });
    expect(describeIntegrationChange(a, b)).toEqual([
      'Endpoint OK → error',
      'HTTP 200 → 503',
    ]);
  });

  it('describes a latency spike with before → after ms', () => {
    const a = base();
    const b = base({ endpoint: { ok: true, status: 200, ms: 120 + LATENCY_SPIKE_MS, detail: 'ok' } });
    expect(describeIntegrationChange(a, b)).toEqual([
      `Latency 120ms → ${120 + LATENCY_SPIKE_MS}ms`,
    ]);
  });

  it('ignores sub-threshold latency jitter', () => {
    const a = base();
    const b = base({ endpoint: { ok: true, status: 200, ms: 125, detail: 'ok' } });
    expect(describeIntegrationChange(a, b)).toEqual([]);
  });

  it('describes an endpoint appearing (null → ping)', () => {
    expect(describeIntegrationChange(base({ endpoint: null }), base())).toEqual([
      'Endpoint now responding',
    ]);
  });

  it('describes an endpoint disappearing (ping → null)', () => {
    expect(describeIntegrationChange(base(), base({ endpoint: null }))).toEqual([
      'Endpoint no longer reported',
    ]);
  });

  it('describes latency going null → non-null (timeout ending)', () => {
    const a = base({ endpoint: { ok: false, status: null, ms: null, detail: 'Unreachable' } });
    const b = base();
    expect(describeIntegrationChange(a, b)).toEqual([
      'Endpoint error → OK',
      'Status now 200',
      'Latency now 120ms',
    ]);
  });

  it('describes an origin becoming authorized', () => {
    const a = base();
    const b = base({
      authDomains: { ok: true, origin: 'portfolio-app-freebuff.vercel.app', href: 'https://console.firebase.google.com' },
    });
    expect(describeIntegrationChange(a, b)).toEqual([
      'Origin portfolio-app-freebuff.vercel.app is authorized',
    ]);
  });

  it('describes an origin no longer authorized', () => {
    const a = base({
      authDomains: { ok: true, origin: 'portfolio-app-freebuff.vercel.app', href: 'https://console.firebase.google.com' },
    });
    const b = base({
      authDomains: { ok: false, origin: 'portfolio-app-freebuff.vercel.app', href: 'https://console.firebase.google.com' },
    });
    expect(describeIntegrationChange(a, b)).toEqual([
      'Origin portfolio-app-freebuff.vercel.app no longer authorized',
    ]);
  });
});

// ─── computeChangedSummaries ───────────────────────────────────────────────

describe('computeChangedSummaries', () => {
  const gh = (over: Partial<IntegrationStatus> = {}): IntegrationStatus => ({
    id: 'github',
    name: 'GitHub',
    enabled: false,
    configured: false,
    env: [{ name: 'GITHUB_TOKEN', set: false, required: true }],
    endpoint: null,
    ...over,
  });

  it('returns [] on the first check (no previous snapshot)', () => {
    expect(computeChangedSummaries(null, [base()])).toEqual([]);
  });

  it('returns id plus the flipped-field descriptions', () => {
    const prev = [base()];
    const next = [base({ endpoint: { ok: false, status: 503, ms: 90, detail: 'Service Unavailable' } })];
    expect(computeChangedSummaries(prev, next)).toEqual([
      { id: 'supabase', changes: ['Endpoint OK → error', 'HTTP 200 → 503'] },
    ]);
  });

  it('returns multiple summaries when several integrations changed', () => {
    const prev = [base(), gh()];
    const next = [base({ enabled: false }), gh({ configured: true })];
    expect(computeChangedSummaries(prev, next)).toEqual([
      { id: 'supabase', changes: ['Live flag turned off'] },
      { id: 'github', changes: ['Now configured'] },
    ]);
  });

  it('returns [] when nothing changed', () => {
    expect(computeChangedSummaries([base(), gh()], [base(), gh()])).toEqual([]);
  });
});

// ─── computeChangedIds ──────────────────────────────────────────────────────

describe('computeChangedIds', () => {
  const gh = (over: Partial<IntegrationStatus> = {}): IntegrationStatus => ({
    id: 'github',
    name: 'GitHub',
    enabled: false,
    configured: false,
    env: [{ name: 'GITHUB_TOKEN', set: false, required: true }],
    endpoint: null,
    ...over,
  });

  it('returns [] on the first check (no previous snapshot)', () => {
    expect(computeChangedIds(null, [base()])).toEqual([]);
  });

  it('returns ids of integrations that changed between consecutive checks', () => {
    const prev = [base(), gh()];
    const next = [
      base(),
      gh({ configured: true, endpoint: { ok: true, status: 200, ms: 60, detail: 'ok' } }),
    ];
    expect(computeChangedIds(prev, next)).toEqual(['github']);
  });

  it('returns multiple ids when several integrations changed', () => {
    const prev = [base(), gh()];
    const next = [base({ enabled: false }), gh({ configured: true })];
    expect(computeChangedIds(prev, next).sort()).toEqual(['github', 'supabase']);
  });

  it('returns [] when nothing changed', () => {
    const prev = [base(), gh()];
    expect(computeChangedIds(prev, [base(), gh()])).toEqual([]);
  });

  it('ignores a latency delta under the spike threshold', () => {
    const prev = [base()];
    const next = [base({ endpoint: { ok: true, status: 200, ms: 140, detail: 'ok' } })];
    expect(computeChangedIds(prev, next)).toEqual([]);
  });
});
