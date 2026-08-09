import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DYNAMIC_BY_DESIGN, findGalleryDrift } from './verify-gallery-stability.mjs';

// ============================================================================
// scripts/verify-gallery-stability.test.ts — lock the gallery byte-stability
// gate (scripts/verify-gallery-stability.mjs).
//
// The scheduled workflow (.github/workflows/gallery-stability.yml, contract
// locked in ci-workflows.test.ts) captures the same demo-mode preview twice
// and diffs the two captures; this test locks the diff LOGIC the workflow
// runs on, so a determinism regression is caught in the suite AND on the
// nightly runner. The DYNAMIC_BY_DESIGN allowlist is locked to exactly the
// three documented files, so a new churning cell forces a deliberate,
// commented allowlist change instead of a silent gate widening.
// ============================================================================

const makeDir = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'gallery-stability-'));
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(dir, name), bytes);
  }
  return dir;
};

const cleanup = (...dirs) => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
};

const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]);

describe('findGalleryDrift', () => {
  it('reports no drift for byte-identical captures', () => {
    const a = makeDir({ 'command-center.png': PNG_A, 'reports.png': PNG_A, 'screenshots.html': 'sheet-1' });
    const b = makeDir({ 'command-center.png': PNG_A, 'reports.png': PNG_A, 'screenshots.html': 'sheet-1' });
    try {
      const d = findGalleryDrift(a, b);
      expect(d).toEqual({ missingDir: null, compared: 3, changed: [], allowedChanged: [], missing: [], extra: [] });
    } finally {
      cleanup(a, b);
    }
  });

  it('flags a changed demo cell as real drift', () => {
    const a = makeDir({ 'integrations-dark.png': PNG_A });
    const b = makeDir({ 'integrations-dark.png': PNG_B });
    try {
      const d = findGalleryDrift(a, b);
      expect(d.changed).toEqual(['integrations-dark.png']);
      expect(d.allowedChanged).toEqual([]);
      expect(d.compared).toBe(1);
    } finally {
      cleanup(a, b);
    }
  });

  it('keeps allowlisted files out of the drift set (informational only)', () => {
    const a = makeDir({ 'route.png': PNG_A, 'deployments-feed.png': PNG_A, 'screenshots.html': 'sheet-1', 'review-sheet-preview.png': PNG_A });
    const b = makeDir({ 'route.png': PNG_A, 'deployments-feed.png': PNG_B, 'screenshots.html': 'sheet-2', 'review-sheet-preview.png': PNG_B });
    try {
      const d = findGalleryDrift(a, b);
      expect(d.changed).toEqual([]);
      expect(d.allowedChanged.sort()).toEqual(['deployments-feed.png', 'review-sheet-preview.png', 'screenshots.html']);
    } finally {
      cleanup(a, b);
    }
  });

  it('flags a file present in only one capture (a skipped cell)', () => {
    const a = makeDir({ 'route.png': PNG_A, 'projects-dark.png': PNG_A });
    const b = makeDir({ 'route.png': PNG_A });
    try {
      const d = findGalleryDrift(a, b);
      expect(d.missing).toEqual(['projects-dark.png']);
      expect(d.extra).toEqual([]);
    } finally {
      cleanup(a, b);
    }
  });

  it('flags a file present in only the second capture (extra)', () => {
    const a = makeDir({ 'route.png': PNG_A });
    const b = makeDir({ 'route.png': PNG_A, 'projects-dark.png': PNG_A });
    try {
      const d = findGalleryDrift(a, b);
      expect(d.missing).toEqual([]);
      expect(d.extra).toEqual(['projects-dark.png']);
    } finally {
      cleanup(a, b);
    }
  });

  it('reports a missing dir instead of silently passing', () => {
    const a = makeDir({ 'route.png': PNG_A });
    const b = join(tmpdir(), `does-not-exist-${Date.now()}`);
    try {
      const d = findGalleryDrift(a, b);
      expect(d.missingDir).toBe(b);
      expect(d.compared).toBe(0);
    } finally {
      cleanup(a);
    }
  });

  it('ignores dotfiles (macOS .DS_Store is never a gallery cell)', () => {
    const a = makeDir({ 'route.png': PNG_A, '.DS_Store': 'junk' });
    const b = makeDir({ 'route.png': PNG_A });
    try {
      const d = findGalleryDrift(a, b);
      expect(d.missing).toEqual([]);
      expect(d.extra).toEqual([]);
      expect(d.changed).toEqual([]);
    } finally {
      cleanup(a, b);
    }
  });

  it('respects a caller-supplied allowlist override', () => {
    const a = makeDir({ 'cell.png': PNG_A });
    const b = makeDir({ 'cell.png': PNG_B });
    try {
      expect(findGalleryDrift(a, b, ['cell.png']).changed).toEqual([]);
      expect(findGalleryDrift(a, b, []).changed).toEqual(['cell.png']);
    } finally {
      cleanup(a, b);
    }
  });
});

describe('DYNAMIC_BY_DESIGN allowlist', () => {
  it('locks the allowlist to the three documented dynamic files', () => {
    // A new churning cell must be added here WITH a comment explaining why
    // it cannot be pinned; silently growing the set would widen the gate.
    expect(DYNAMIC_BY_DESIGN).toEqual([
      'screenshots.html',
      'deployments-feed.png',
      'review-sheet-preview.png',
    ]);
  });
});
