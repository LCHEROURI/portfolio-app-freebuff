import { describe, expect, it } from 'vitest';

import { classifyFeedPage, MIN_ROWS } from './capture-deployments-feed.mjs';

// ============================================================================
// scripts/capture-deployments-feed.test.ts — lock the live-feed classifier.
//
// capture-deployments-feed.mjs captures the LIVE /deployments page (Vercel +
// Firebase rows with health checks) for the gallery. Its pure classifier,
// classifyFeedPage, turns the page's innerText into a readiness verdict — the
// ONLY gate between the driver and capturing a demo-mode or half-rendered
// feed. This suite locks that gate so a future edit cannot weaken it into
// accepting sample data (the NEXT_PUBLIC_LIVE_DEPLOYMENTS-off regression the
// driver exists to catch), a single provider, or an empty grid.
//
// The live markers are deliberately tolerant of the headless font quirk that
// drops trailing letters ('Fireba e' instead of 'Firebase'): provider checks
// use a prefix, so both the full word and the rendered truncation count.
// ============================================================================

// A realistic ready page: live badge, metric grid (StatCards render
// UPPERCASE), both provider rows, and enough deployment cards. Each card
// carries one 'Open' link, so rows === count of 'Open'.
const READY_TEXT = [
  'Deployments',
  'Live health checks Deployments and statuses fetched from Vercel; each URL is probed for its HTTP status and response time.',
  'TOTAL DEPLOYMENTS 8',
  'portfolio-app-freebuff Vercel · production HEALTHY READY 200 · 251ms checked just now Open',
  'portfolio-app-freebuff2 Firebase · production HEALTHY READY 200 · 3ms checked just now Open',
  'freebuff-meal Vercel · production HEALTHY READY 200 · 310ms checked just now Open',
  'newark-websites25 Vercel · production HEALTHY READY 200 · 290ms checked just now Open',
  'prompt-vault-pro Vercel · production HEALTHY READY 200 · 270ms checked just now Open',
  'mortgage-zip-lead-engine Vercel · production HEALTHY READY 200 · 260ms checked just now Open',
  'tip-compass Vercel · production HEALTHY READY 200 · 280ms checked just now Open',
  'reviewmaestro-production Vercel · production HEALTHY READY 200 · 240ms checked just now Open',
].join(' ');

describe('classifyFeedPage', () => {
  it('declares a ready page with the live badge, metrics, both providers, and enough rows', () => {
    const v = classifyFeedPage(READY_TEXT);
    expect(v.ready).toBe(true);
    expect(v.live).toBe(true);
    expect(v.metrics).toBe(true);
    expect(v.firebase).toBe(true);
    expect(v.vercel).toBe(true);
    expect(v.rows).toBeGreaterThanOrEqual(MIN_ROWS);
  });

  it('tolerates the headless font quirk that drops trailing letters from provider labels', () => {
    // The captured page renders 'Fireba e' (dropped 's') in headless Chrome;
    // the classifier must still recognize the Firebase provider.
    const quirk = READY_TEXT.replace('Firebase ·', 'Fireba e ·').replace('Vercel ·', 'Verce ·');
    const v = classifyFeedPage(quirk);
    expect(v.firebase).toBe(true);
    expect(v.vercel).toBe(true);
    expect(v.ready).toBe(true);
  });

  it('never mistakes the page description for a provider row', () => {
    // The description line says "fetched from Vercel" — a naive includes()
    // check would count that as a Vercel row even on a Firebase-only feed.
    // Only a card line (provider + interpunct + environment) may satisfy the
    // provider checks.
    const descriptionOnly = READY_TEXT.replace(/[a-z0-9-]+ Vercel · production HEALTHY READY 200 · \d+ms checked just now Open/g, '').replace('TOTAL DEPLOYMENTS 8', 'TOTAL DEPLOYMENTS 1');
    const v = classifyFeedPage(descriptionOnly);
    expect(v.vercel).toBe(false);
    expect(v.ready).toBe(false);
  });

  it('never accepts demo-mode data (no live badge — the NEXT_PUBLIC_LIVE_DEPLOYMENTS-off regression)', () => {
    // The exact regression the driver exists to catch: the feed works
    // server-side but the client renders the demo description and a live flag
    // that is off. Without the 'Live health checks' badge the page must NOT be
    // ready, even when providers and rows are present.
    const demo = READY_TEXT
      .replace('Live health checks Deployments and statuses fetched from Vercel; each URL is probed for its HTTP status and response time.', 'Every environment, health check, and rollout across all versions.')
      .replace('checked just now', 'deployed 2d ago');
    const v = classifyFeedPage(demo);
    expect(v.live).toBe(false);
    expect(v.ready).toBe(false);
  });

  it('requires BOTH providers — a Vercel-only or Firebase-only feed is not ready', () => {
    const noFirebase = READY_TEXT.replace('portfolio-app-freebuff2 Firebase · production HEALTHY READY 200 · 3ms checked just now Open', '');
    expect(classifyFeedPage(noFirebase).firebase).toBe(false);
    expect(classifyFeedPage(noFirebase).ready).toBe(false);

    const noVercel = READY_TEXT.replace(/[a-z0-9-]+ Vercel · production HEALTHY READY 200 · \d+ms checked just now Open/g, '').replace('TOTAL DEPLOYMENTS 8', 'TOTAL DEPLOYMENTS 1');
    expect(classifyFeedPage(noVercel).vercel).toBe(false);
    expect(classifyFeedPage(noVercel).ready).toBe(false);
  });

  it('requires the metric grid — an empty page or missing StatCards is not ready', () => {
    const noMetrics = READY_TEXT.replace('TOTAL DEPLOYMENTS 8', '');
    expect(classifyFeedPage(noMetrics).metrics).toBe(false);
    expect(classifyFeedPage(noMetrics).ready).toBe(false);
  });

  it('requires at least MIN_ROWS deployment cards', () => {
    // Remove one actual card (one 'Open' link) AND the metric count, so the
    // rows count really drops below the bar — the metric text alone must not
    // change the verdict.
    const thin = READY_TEXT
      .replace('TOTAL DEPLOYMENTS 8', `TOTAL DEPLOYMENTS ${MIN_ROWS - 1}`)
      .replace(/[a-z0-9-]+ Vercel · production HEALTHY READY 200 · \d+ms checked just now Open/, '');
    const v = classifyFeedPage(thin);
    expect(v.rows).toBeLessThan(MIN_ROWS);
    expect(v.ready).toBe(false);
  });

  it('returns a non-ready verdict for empty or null text', () => {
    expect(classifyFeedPage('').ready).toBe(false);
    expect(classifyFeedPage(null).ready).toBe(false);
    expect(classifyFeedPage(undefined).ready).toBe(false);
  });

  it('locks MIN_ROWS to the currently monitored deployment count (8 = 7 Vercel + 1 Firebase)', () => {
    // The constant is the contract with the live feed: the gallery cell must
    // show the full real grid, so a change to the monitored repo set must
    // update this number deliberately, and the classifier test with it.
    expect(MIN_ROWS).toBe(8);
  });
});
