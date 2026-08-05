import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// ============================================================================
// firestore.rules coverage spec.
//
// The app now runs on its dedicated Firebase project with a portfolio-only
// ruleset. These tests parse the rules text and assert every portfolio
// collection still has its rules block with per-user isolation, so a future
// edit can't silently drop or relax a collection.
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

const hasBlock = (collection: string): boolean => {
  const escaped = collection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`match /${escaped}/\\{`).test(rules);
};

const indexOf = (needle: string): number => rules.indexOf(needle);

describe('firestore.rules — portfolio-only spec', () => {
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

  it('no longer contains the meal-planner collections', () => {
    for (const c of ['users', 'mealPlans', 'publicShares', 'generationUsage', 'cookingSessions', 'pantryItems']) {
      expect(hasBlock(c), `meal-planner collection /${c} must be gone`).toBe(false);
    }
  });

  it('keeps the catch-all deny last', () => {
    const catchAll = indexOf('match /{document=**}');
    expect(catchAll).toBeGreaterThan(-1);
    for (const c of PORTFOLIO) {
      const block = indexOf(`match /${c}/{`);
      expect(block, `/${c} block must exist`).toBeGreaterThan(-1);
      expect(block, `/${c} block must precede the catch-all deny`).toBeLessThan(catchAll);
    }
  });
});
