import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/dev-scripts-no-vercel.test.ts — no dev script may fall back to the
// retired Vercel host.
//
// The Vercel deployment was retired in favor of Firebase App Hosting
// (portfolio-app-freebuff--portfolio-app-freebuff2.us-central1.hosted.app).
// The app code and CI are clean, but five dev/seed/verify HELPER scripts kept
// the old https://portfolio-app-freebuff.vercel.app as their DEFAULT target —
// running any of them bare probed the dead Vercel host instead of the live
// backend (2026-09-07 sweep). They honor --flag / env overrides first, so CI
// was never affected; the default is what a developer hits when running the
// script bare. Every one of those defaults is now the canonical Firebase URL.
//
// This test locks the invariant at the SOURCE level: a future edit that
// reintroduces a functional .vercel.app default in any of these scripts fails
// here instead of silently pointing dev tooling at a dead host. (Legitimate
// historical mentions — comments describing the retired host, seeded demo
// data for FAKE projects — are not "functional defaults" and live elsewhere;
// this suite scopes to the five scripts whose URL constant would be probed.)
// ============================================================================

const CANONICAL = 'https://portfolio-app-freebuff--portfolio-app-freebuff2.us-central1.hosted.app';

// The five scripts whose DEFAULT target is probed when run bare. Each entry
// names the file and the flag/env that must override the default (kept as a
// comment anchor, not asserted — the override mechanism is per-script).
const DEV_SCRIPTS = [
  'scripts/seed-in-app-reports.mjs', // --base / VERIFY_BASE_URL
  'scripts/tour-live.mjs', // --app / VERIFY_BASE_URL
  'scripts/verify-prod-matrix.mjs', // PROD_URL
  'scripts/verify-profile-no-email.mjs', // --app / VERIFY_BASE_URL
  'scripts/authorize-domain.mjs', // --domain
];

describe('dev-script defaults point at Firebase, never the retired Vercel host', () => {
  it('contains zero functional .vercel.app references across all five scripts', () => {
    for (const file of DEV_SCRIPTS) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file}: no .vercel.app may remain (retired host)`).not.toMatch(/portfolio-app-freebuff\.vercel\.app/);
    }
  });

  it('every script carries the canonical Firebase URL as its default target', () => {
    for (const file of DEV_SCRIPTS) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file}: must reference the canonical Firebase URL`).toContain(CANONICAL);
    }
  });

  it('the canonical URL is the same single source of truth the deploy gate uses', () => {
    // Cross-check with the shared driver so the five scripts can never drift
    // from what the deployed-hash gate and CI actually probe.
    const driver = readFileSync('scripts/verify-deployed-hash.mjs', 'utf8');
    expect(driver).toContain(CANONICAL);
  });
});