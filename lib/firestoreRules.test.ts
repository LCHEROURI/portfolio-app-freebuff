import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// ============================================================================
// firestore.rules coverage spec.
//
// The shared project runs ONE merged ruleset: Section A (meal-planner
// collections kept verbatim from the original ../firestore.rules) and
// Section B (portfolio collections with per-user isolation). These tests
// parse the rules text and assert every collection from both apps still has
// its rules block with the right scoping, so a future edit can't silently
// drop or relax a collection.
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

// Meal-planner collections from the original ../firestore.rules (Section A),
// which must survive the merge verbatim.
const MEAL_PLANNER = [
  'users',
  'mealPlans',
  'publicShares',
  'generationUsage',
  'cookingSessions',
  'pantryItems',
] as const;

const hasBlock = (collection: string): boolean => {
  const escaped = collection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`match /${escaped}/\\{`).test(rules);
};

const indexOf = (needle: string): number => rules.indexOf(needle);

/** Extract one top-level collection block (from its `match /` to the next). */
const blockOf = (collection: string): string => {
  const start = rules.indexOf(`match /${collection}/{`);
  if (start === -1) return '';
  const next = rules.indexOf('\n    match /', start + 1);
  return rules.slice(start, next === -1 ? rules.length : next);
};

describe('firestore.rules — merged spec', () => {
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

  it('keeps every meal-planner collection from the original file', () => {
    for (const c of MEAL_PLANNER) {
      expect(hasBlock(c), `missing rules block for /${c}`).toBe(true);
    }
  });

  it('keeps the meal-planner field-level create constraints', () => {
    // users: displayName is required and string; householdSize is a positive int.
    const users = blockOf('users');
    expect(users).toMatch(/keys\(\)\.hasAll\(\['displayName'\]\)/);
    expect(users).toMatch(/request\.resource\.data\.displayName is string/);
    expect(users).toMatch(/request\.resource\.data\.householdSize is int/);
    expect(users).toMatch(/request\.resource\.data\.householdSize >= 1/);
    // users: the update allow-list (changedKeys().hasOnly) must stay.
    expect(users).toMatch(/changedKeys\(\)\.hasOnly\(\[/);

    // mealPlans: ownerId is claimed on create and immutable on update.
    const mealPlans = blockOf('mealPlans');
    expect(mealPlans).toMatch(/request\.resource\.data\.ownerId == request\.auth\.uid/);
    expect(mealPlans).toMatch(/request\.resource\.data\.ownerId == resource\.data\.ownerId/);
  });

  it('keeps the catch-all deny last', () => {
    const catchAll = indexOf('match /{document=**}');
    expect(catchAll).toBeGreaterThan(-1);
    for (const c of [...PORTFOLIO, ...MEAL_PLANNER]) {
      const block = indexOf(`match /${c}/{`);
      expect(block, `/${c} block must exist`).toBeGreaterThan(-1);
      expect(block, `/${c} block must precede the catch-all deny`).toBeLessThan(catchAll);
    }
  });
});
