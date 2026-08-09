// ============================================================================
// scripts/local-env.mjs — the ONLY sanctioned single-key .env.local reader.
//
// A `vercel env pull` writes values in quoted form (`KEY="value"`). Every gate
// that historically read .env.local with its own regex forgot to strip the
// quotes somewhere: gate 3's Google IdP checks called the API with
// `"AIza…"`-with-quotes, and the Firestore probe 404'd on the quoted project
// id — the same incident twice because the stripping lived in N copies, and
// some copies had it while others (verify-firestore-rules, verify-prod-signin
// project id, seed-in-app-reports, wire-google-client) did not. This module
// centralizes the read so the stripping happens exactly once, in tested code:
//
//   • readLocalEnv(name) — process.env first, then .env.local, quotes
//     stripped. The file path is overridable so tests can point at temp files.
//   • stripQuotes(value) — pure: trim + strip ONE surrounding quote pair
//     (double or single). JSON-shaped values keep their inner escapes, so
//     JSON.parse(FIREBASE_SERVICE_ACCOUNT) still works.
//
// scripts/local-env.test.ts locks the behavior AND scans every scripts/*.mjs
// to forbid a future raw readFileSync + .match() value extraction outside
// this module. verify-vercel-env.mjs parses the WHOLE file (parseEnvFile, a
// different job that also strips quotes) and verify-all.mjs only
// presence-tests keys (`.test()`, quote-agnostic) — both are explicitly
// exempt.
// ============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Trim a value and strip ONE surrounding quote pair (double or single). */
export const stripQuotes = (value) => {
  if (value == null) return value;
  const s = String(value).trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
};

// Cache per path so a gate that reads several keys does not re-read the file.
const cache = new Map();

/**
 * Read a single key from an env file with quotes stripped.
 * @param {string} name the key (e.g. 'NEXT_PUBLIC_FIREBASE_API_KEY')
 * @param {string} [file] the env file path relative to cwd (tests override)
 * @returns {string | undefined} the unquoted value, '' for a bare KEY=,
 *   undefined when the key is absent or the file is missing
 */
export const readLocalEnv = (name, file = '.env.local') => {
  // Same precedence every gate uses internally: the real env var first.
  if (process.env[name]) return process.env[name];
  let env = cache.get(file);
  if (env === undefined) {
    try {
      env = readFileSync(resolve(process.cwd(), file), 'utf8');
    } catch {
      env = '';
    }
    cache.set(file, env);
  }
  // The m flag anchors ^ per LINE (secrets are not necessarily on line 1).
  const m = env.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return m ? stripQuotes(m[1]) : undefined;
};
