#!/usr/bin/env node
// ============================================================================
// scripts/verify-gallery-stability.mjs — byte-stability gate for the gallery.
//
// Compares two full gallery capture directories (the output of
// capture-screenshots.sh / capture-gallery.mjs: the 18 route cells, the
// review-sheet pair, the deployments-feed cell, and the HTML contact sheet)
// and fails on ANY byte drift outside the documented DYNAMIC_BY_DESIGN set.
// Runs in .github/workflows/gallery-stability.yml: the workflow captures the
// same demo-mode preview twice on a nightly schedule and diffs the two
// captures, so a future determinism regression (a churning demo cell) turns
// the scheduled run red instead of silently shipping a gallery that drifts
// run to run. The determinism flags themselves live in capture-gallery.mjs
// and are locked by capture-gallery.test.ts; this gate is the enforcement
// that they keep working on the real runner.
//
// What the allowlist is for (each entry is dynamic BY DESIGN, never a
// determinism failure):
//   screenshots.html         — the contact sheet embeds the capture date.
//   deployments-feed.png     — live signed-in capture; real timestamps move
//                              as deploys land between the two captures.
//   review-sheet-preview.png — the accepted run-to-run AI-note text drift
//                              (documented in docs/launch.md's review-sheet
//                              row); no flag can pin the live model's wording.
// Every other file in the two dirs must be byte-identical, and the file SETS
// must match (a cell skipped in one capture is a failure, not a pass).
//
// Usage:
//   node scripts/verify-gallery-stability.mjs --a <capture-1-dir> --b <capture-2-dir>
// Exit codes: 0 = byte-stable, 1 = drift or comparison failure, 2 = usage.
// ============================================================================

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Files allowed to differ between two captures. A new dynamic cell must be
// added here WITH a comment explaining why — verify-gallery-stability.test.ts
// locks this set to exactly these three, so a silent allowlist growth fails
// the suite instead of quietly widening the gate.
export const DYNAMIC_BY_DESIGN = [
  'screenshots.html',          // contact sheet carries the capture date
  'deployments-feed.png',      // live signed-in capture: real timestamps
  'review-sheet-preview.png',  // accepted live-AI note-text drift
];

/**
 * Compare two capture directories byte for byte.
 * @param {string} dirA first capture dir
 * @param {string} dirB second capture dir
 * @param {string[]} [allowDynamic] filenames permitted to differ (by design)
 * @returns {{ missingDir: string | null, compared: number,
 *             changed: string[], allowedChanged: string[],
 *             missing: string[], extra: string[] }}
 *   missingDir   — set when a dir is missing/unreadable (never silently empty)
 *   compared     — files present in BOTH dirs and compared
 *   changed      — files whose bytes differ and are NOT allowlisted (drift)
 *   allowedChanged — files whose bytes differ and ARE allowlisted (by design)
 *   missing      — files present in A only (a skipped cell in B)
 *   extra        — files present in B only
 */
export const findGalleryDrift = (dirA, dirB, allowDynamic = DYNAMIC_BY_DESIGN) => {
  const list = (dir) => {
    try {
      // Dotfiles (.DS_Store on macOS) are never gallery cells — ignore them.
      return readdirSync(dir).filter((f) => !f.startsWith('.')).sort();
    } catch {
      return null;
    }
  };
  const a = list(dirA);
  const b = list(dirB);
  if (!a || !b) {
    return { missingDir: !a ? dirA : dirB, compared: 0, changed: [], allowedChanged: [], missing: [], extra: [] };
  }

  const changed = [];
  const allowedChanged = [];
  const missing = [];
  const extra = [];
  let compared = 0;
  for (const f of new Set([...a, ...b])) {
    if (!a.includes(f)) { extra.push(f); continue; }   // B only → extra
    if (!b.includes(f)) { missing.push(f); continue; } // A only → missing
    compared += 1;
    if (!readFileSync(`${dirA}/${f}`).equals(readFileSync(`${dirB}/${f}`))) {
      (allowDynamic.includes(f) ? allowedChanged : changed).push(f);
    }
  }
  return { missingDir: null, compared, changed, allowedChanged, missing, extra };
};

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  const dirA = flag('--a');
  const dirB = flag('--b');
  if (!dirA || !dirB) {
    console.error('Usage: node scripts/verify-gallery-stability.mjs --a <capture-1-dir> --b <capture-2-dir>');
    process.exit(2);
  }

  const d = findGalleryDrift(dirA, dirB);
  let failures = 0;
  let fileSetOk = true;

  if (d.missingDir) {
    console.error(`  ✗ FAIL: capture directory missing or unreadable: ${d.missingDir}`);
    failures += 1;
    fileSetOk = false;
  } else {
    console.log(`  ✓ compared ${d.compared} files across the two captures`);
    for (const f of d.allowedChanged) {
      console.log(`  · allowed dynamic drift (by design): ${f}`);
    }
    for (const f of d.changed) {
      console.error(`  ✗ FAIL: demo-cell byte drift: ${f} (must be byte-identical across captures)`);
      failures += 1;
    }
    for (const f of d.missing) {
      console.error(`  ✗ FAIL: only in capture 1: ${f} (file sets must match)`);
      failures += 1;
      fileSetOk = false;
    }
    for (const f of d.extra) {
      console.error(`  ✗ FAIL: only in capture 2: ${f} (file sets must match)`);
      failures += 1;
      fileSetOk = false;
    }
    if (failures === 0) {
      console.log('  ✓ every demo cell is byte-identical across the two captures');
    }
  }

  console.log(`VERIFY-SUBRESULT|demo-cells|${failures === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`VERIFY-SUBRESULT|file-set|${fileSetOk ? 'PASS' : 'FAIL'}`);
  console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}
