import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { readLocalEnv, stripQuotes } from './local-env.mjs';

// ============================================================================
// scripts/local-env.test.ts — lock the quote-stripping env reader.
//
// A `vercel env pull` writes .env.local values in quoted form; the gates that
// read them must strip the quotes or they call Google/Firestore with literal
// quote characters (gate 3's IdP checks + the Firestore probe both broke this
// way). This file locks the shared reader's behavior AND scans every
// scripts/*.mjs on the live tree to forbid a future raw value extraction
// outside the helper — the same live-tree-scan philosophy as the SUBRESULT
// and capture-gallery contract locks.
// ============================================================================

// A key name that cannot collide with the test runner's process.env.
const KEY = 'FREE_BUFF_LOCAL_ENV_TEST';

describe('stripQuotes', () => {
  it('leaves an unquoted value untouched', () => {
    expect(stripQuotes('plain-value')).toBe('plain-value');
    expect(stripQuotes('AIzaSyAbCdEfGh')).toBe('AIzaSyAbCdEfGh');
    expect(stripQuotes('team_AbC123')).toBe('team_AbC123');
  });

  it('strips one surrounding double-quote pair (the vercel env pull format)', () => {
    expect(stripQuotes('"quoted"')).toBe('quoted');
    expect(stripQuotes('"a b c"')).toBe('a b c');
    expect(stripQuotes('""')).toBe('');
  });

  it('strips one surrounding single-quote pair too', () => {
    expect(stripQuotes("'quoted'")).toBe('quoted');
    expect(stripQuotes("''")).toBe('');
  });

  it('trims surrounding whitespace before deciding', () => {
    expect(stripQuotes('  value  ')).toBe('value');
    expect(stripQuotes('  "value"  ')).toBe('value');
  });

  it('leaves a pull-formatted JSON value parseable (FIREBASE_SERVICE_ACCOUNT shape)', () => {
    // A real `vercel env pull` wraps values in outer quotes but does NOT
    // escape the inner ones: the SA line is KEY="{"type":…}" with raw inner
    // quotes and \n kept as-is. Stripping only the outer pair must leave
    // JSON.parse working — verified against an actual pull (never \"-escaped).
    const raw = '"{"type":"service_account","project_id":"p"}"';
    expect(stripQuotes(raw)).toBe('{"type":"service_account","project_id":"p"}');
    expect(JSON.parse(stripQuotes(raw))).toEqual({ type: 'service_account', project_id: 'p' });
  });

  it('handles null and undefined', () => {
    expect(stripQuotes(undefined)).toBeUndefined();
    expect(stripQuotes(null)).toBeNull();
  });
});

describe('readLocalEnv', () => {
  beforeEach(() => {
    delete process.env[KEY];
  });

  const makeEnv = (contents) => {
    const dir = mkdtempSync(join(tmpdir(), 'local-env-'));
    const file = join(dir, '.env.local');
    writeFileSync(file, contents);
    return file;
  };

  it('reads a plain unquoted value', () => {
    const f = makeEnv(`${KEY}=plain-value\n`);
    try { expect(readLocalEnv(KEY, f)).toBe('plain-value'); } finally { rmSync(f, { force: true }); }
  });

  it('strips double quotes (the pull format that broke gate 3)', () => {
    const f = makeEnv(`${KEY}="quoted-value"\n`);
    try { expect(readLocalEnv(KEY, f)).toBe('quoted-value'); } finally { rmSync(f, { force: true }); }
  });

  it('strips single quotes too', () => {
    const f = makeEnv(`${KEY}='single'\n`);
    try { expect(readLocalEnv(KEY, f)).toBe('single'); } finally { rmSync(f, { force: true }); }
  });

  it('matches the key on any line, not just the first', () => {
    const f = makeEnv(`OTHER=1\n${KEY}=deep\n`);
    try { expect(readLocalEnv(KEY, f)).toBe('deep'); } finally { rmSync(f, { force: true }); }
  });

  it('returns the empty string for a bare empty value', () => {
    const f = makeEnv(`${KEY}=\n`);
    try { expect(readLocalEnv(KEY, f)).toBe(''); } finally { rmSync(f, { force: true }); }
  });

  it('returns undefined for a missing key or a missing file', () => {
    const f = makeEnv('OTHER=1\n');
    try {
      expect(readLocalEnv(KEY, f)).toBeUndefined();
      expect(readLocalEnv(KEY, join(tmpdir(), `no-such-env-${Date.now()}`))).toBeUndefined();
    } finally { rmSync(f, { force: true }); }
  });

  it('round-trips a pull-formatted service-account JSON through JSON.parse', () => {
    // The pull's actual SA line shape: KEY="{"type":…}" — raw inner quotes.
    const f = makeEnv(`${KEY}="{"type":"service_account","project_id":"p"}"\n`);
    try {
      expect(JSON.parse(readLocalEnv(KEY, f))).toEqual({ type: 'service_account', project_id: 'p' });
    } finally { rmSync(f, { force: true }); }
  });

  it('prefers the real env var over the file (the repo-wide precedence)', () => {
    const f = makeEnv(`${KEY}=from-file\n`);
    try {
      process.env[KEY] = 'from-env';
      expect(readLocalEnv(KEY, f)).toBe('from-env');
    } finally {
      delete process.env[KEY];
      rmSync(f, { force: true });
    }
  });
});

// ── Live-tree contract: no raw .env.local value reads outside the helper ────
describe('local-env contract · every .env.local value read goes through readLocalEnv', () => {
  const scriptsDir = join(process.cwd(), 'scripts');
  // Whole-file contexts allowed to touch .env.local directly:
  //   local-env.mjs         — the helper itself.
  //   verify-vercel-env.mjs — parses the WHOLE file (parseEnvFile) to diff
  //                           the stores; a different job, and it strips
  //                           quotes too.
  //   verify-all.mjs        — only PRESENCE-tests keys (`^KEY=` via .test(),
  //                           never .match()) — quote-agnostic by design.
  const ALLOWED_RAW = new Set(['local-env.mjs', 'verify-vercel-env.mjs', 'verify-all.mjs']);

  it('no .mjs file re-implements quote stripping with the old regex (the duplicate that broke gate 3)', () => {
    // The old per-file stripper was `trim().replace(/^"|"$/g, '')`; one copy
    // of it survived in lib/server/sa-token.mjs after the big migration and
    // is now retired too. A future copy of that regex — anywhere in scripts/
    // or lib/ — fails here, so the stripping logic lives only in the helper
    // (and verify-vercel-env.mjs's whole-file parser, which uses a different
    // startsWith/endsWith form and is a separate, documented job).
    const roots = [join(process.cwd(), 'scripts'), join(process.cwd(), 'lib')];
    const offenders = [];
    for (const root of roots) {
      for (const f of readdirSync(root, { recursive: true }).filter((f) => f.endsWith('.mjs'))) {
        const src = readFileSync(join(root, f), 'utf8');
        if (/replace\(\/\^"\|\"\$\/g/.test(src)) offenders.push(join(root, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no other script extracts a .env.local value with its own anchored regex', () => {
    const offenders = [];
    for (const f of readdirSync(scriptsDir).filter((f) => f.endsWith('.mjs'))) {
      if (ALLOWED_RAW.has(f)) continue;
      const src = readFileSync(join(scriptsDir, f), 'utf8');
      // The dangerous shape: a value extraction from the file contents via an
      // anchored single-key regex (`env.match(/^KEY=…/m)` or
      // `env.match(new RegExp(\`^KEY=…`)). Presence tests use .test() and
      // never read the value — they are quote-agnostic and stay legal.
      if (/env\.match\(\s*(?:\/|new RegExp\(\s*[`"'])\^/.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});
