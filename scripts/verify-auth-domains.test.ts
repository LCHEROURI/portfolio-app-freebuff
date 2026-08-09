import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================================
// scripts/verify-auth-domains.test.ts — lock the demo-mode skip-not-fail
// branch in the authorized-domains gate.
//
// verify-auth-domains.mjs calls the DEPLOYED app's /api/status?project= and
// asserts the Firebase authorized-domains check reports ok:true. That only
// makes sense on a deployment that actually serves Firebase auth: a
// demo-mode deployment (no Firebase client SDK env) answers the probe with
// its own 401 { ok:false, error:'Authentication required.' } because there is
// no project to verify any ID token against — and a deployment with no
// sign-in surface has nothing to protect, so the gate must skip-not-fail
// there (the PR previews this repo deploys are demo-mode by design). The
// real failure paths — a configured deployment whose domain is missing, or a
// 401 that is NOT the app's demo-mode JSON (e.g. Vercel's SSO wall) — must
// still exit 1.
// ============================================================================

const SCRIPT = readFileSync('scripts/verify-auth-domains.mjs', 'utf8');

// The demo-mode skip block: everything between the branch comment and the
// `if (!authDomains)` failure path. Scoping keeps every assertion honest — a
// stray 'exit 0' elsewhere (the final RESULT: PASS path) cannot satisfy them.
const skipBlock = SCRIPT.slice(
  SCRIPT.indexOf('// Demo-mode deployment'),
  SCRIPT.indexOf('if (!authDomains)'),
);

describe('scripts/verify-auth-domains.mjs · demo-mode skip (skip-not-fail)', () => {
  it('has a non-empty demo-mode skip block (comment anchor intact)', () => {
    // A non-empty block guard: if the anchor comment is ever renamed so the
    // slice resolves to '', every assertion below would fail confusingly.
    expect(skipBlock.length).toBeGreaterThan(0);
    expect(SCRIPT).toContain('// Demo-mode deployment');
    expect(SCRIPT).toContain('if (!authDomains) {');
  });

  it('detects the app-own demo-mode 401 (status 401 + ok:false + Authentication required.)', () => {
    // The app's /api/status returns this exact JSON when it cannot verify any
    // ID token (demo mode). Matching the precise predicate distinguishes it
    // from Vercel's SSO 401, whose body is not this JSON — so a protection or
    // network failure still fails loudly instead of being mistaken for demo.
    expect(skipBlock).toContain("res.status === 401 && body?.ok === false && body?.error === 'Authentication required.'");
  });

  it('exits 0 with a SKIP verdict (never exit 1) inside the demo-mode block', () => {
    // Skip-not-fail contract: the demo-mode branch must be green for the
    // preview gate, and must not leak into a hard failure.
    expect(skipBlock).toContain("console.log('RESULT: SKIP (demo mode)');");
    expect(skipBlock).toMatch(/process\.exit\(0\)/);
    expect(skipBlock).not.toMatch(/process\.exit\(1\)/);
  });

  it('orders the demo-mode skip BEFORE the authDomains failure path', () => {
    // On a demo-mode 401, authDomains is undefined, so `if (!authDomains)`
    // would also fire — the skip must come first or the gate would still fail.
    const skipIdx = SCRIPT.indexOf("res.status === 401 && body?.ok === false");
    const failIdx = SCRIPT.indexOf('✗ FAIL: /api/status returned no firebase.authDomains');
    expect(skipIdx).toBeGreaterThan(-1);
    expect(failIdx).toBeGreaterThan(skipIdx);
  });
});

describe('scripts/verify-auth-domains.mjs · real failure paths still fail', () => {
  it('keeps the no-authDomains failure (configured deployment with a missing/unauthorized domain) at exit 1', () => {
    expect(SCRIPT).toContain('✗ FAIL: /api/status returned no firebase.authDomains (HTTP');
    expect(SCRIPT).toContain('✗ FAIL: ${authDomains.origin} is NOT in the project');
    // The final success path and the skip path both exit 0; the FAIL paths must
    // be the ones carrying exit 1.
    expect(SCRIPT.match(/process\.exit\(1\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
