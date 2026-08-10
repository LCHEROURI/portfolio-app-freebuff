import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// ============================================================================
// firestore.rules coverage spec.
//
// The portfolio app and the kitchen agent (cook-with-freebuff) share ONE
// Firebase project, and Firestore rules are deployed PER PROJECT — so the
// repo's firestore.rules is the UNION of both apps' rulesets and must stay
// byte-identical across the two repos. These tests parse the rules text and
// assert every portfolio collection still has its rules block with per-user
// isolation (plus the kitchen-agent collections and the dead meal-planner
// names staying gone), so a future edit can't silently drop or relax any
// part of the shared ruleset.
// ============================================================================

// vitest runs from the repo root, so the rules file resolves reliably here.
const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

// Portfolio collections the Command Center reads/writes (lib/firestore.ts
// COLLECTIONS map). All except `profiles` are scoped by a `userId` field;
// `profiles` docs are keyed by the user's uid, so its rule matches on the
// document id instead of an inner userId field.
const PORTFOLIO = [
  'profiles',
  'projects',
  'project_versions',
  'repositories',
  'deployments',
  'tasks',
  'model_evaluations',
  'activity',
  'reports',
] as const;

// Kitchen-agent collections (cook-with-freebuff). `users` and
// `dietary_profiles` are keyed by uid like `profiles`; the rest are scoped
// by a `userId` field.
const KITCHEN = [
  'users',
  'dietary_profiles',
  'recipes',
  'cooking_sessions',
  'cooking_session_events',
  'timers',
  'pantry_items',
  'agent_tool_logs',
] as const;

const hasBlock = (collection: string): boolean => {
  const escaped = collection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`match /${escaped}/\\{`).test(rules);
};

const indexOf = (needle: string): number => rules.indexOf(needle);

describe('firestore.rules — shared two-app union spec', () => {
  it('covers every portfolio collection', () => {
    for (const c of PORTFOLIO) {
      expect(hasBlock(c), `missing rules block for /${c}`).toBe(true);
    }
  });

  it('enforces per-user isolation on every portfolio collection', () => {
    for (const c of PORTFOLIO) {
      if (c === 'profiles') {
        expect(rules, 'profiles must scope reads/writes to the document id (profileId == auth.uid)')
          .toMatch(/profileId == request\.auth\.uid/);
      } else {
        expect(rules, `/${c} must scope writes by request.resource.data.userId == auth.uid`)
          .toMatch(/request\.resource\.data\.userId == request\.auth\.uid/);
      }
    }
  });

  it('covers every kitchen-agent collection (shared-project union)', () => {
    for (const c of KITCHEN) {
      expect(hasBlock(c), `missing rules block for /${c}`).toBe(true);
    }
  });

  it('enforces per-user isolation on kitchen-agent collections', () => {
    for (const c of KITCHEN) {
      if (c === 'users' || c === 'dietary_profiles') {
        expect(rules, `/${c} must scope access by the document id (match /${c}/{userId})`)
          .toMatch(new RegExp(`match /${c}/\\{userId\\}`, 'i'));
        expect(rules, `/${c} must gate on isOwner(userId)`).toMatch(/isOwner\(userId\)/);
      } else {
        expect(rules, `/${c} must scope writes by request.resource.data.userId == auth.uid`)
          .toMatch(/request\.resource\.data\.userId == request\.auth\.uid/);
      }
    }
  });

  it('keeps the dead meal-planner collections gone', () => {
    // The abandoned meal-planner app's camelCase collections must stay out of
    // the shared ruleset — only the current two apps may be matched.
    for (const c of ['mealPlans', 'publicShares', 'generationUsage', 'cookingSessions', 'pantryItems']) {
      expect(hasBlock(c), `dead meal-planner collection /${c} must be gone`).toBe(false);
    }
  });

  it('keeps the catch-all deny last', () => {
    const catchAll = indexOf('match /{document=**}');
    expect(catchAll).toBeGreaterThan(-1);
    for (const c of [...PORTFOLIO, ...KITCHEN]) {
      const block = indexOf(`match /${c}/{`);
      expect(block, `/${c} block must exist`).toBeGreaterThan(-1);
      expect(block, `/${c} block must precede the catch-all deny`).toBeLessThan(catchAll);
    }
  });
});
