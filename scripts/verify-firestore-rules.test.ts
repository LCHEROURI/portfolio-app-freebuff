import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ── verify-firestore-rules · sandbox-auth SKIP verdict ──────────────────────
// Provisioning Auth in a brand-new Firebase project is a console-only step
// (the first click can't be scripted), so until that click lands the sandbox
// signUp probe returns CONFIGURATION_NOT_FOUND. The gate must then report a
// LOUD SKIP — exit 0, a SKIPPED parent row in verify:all, and a sandbox-auth
// SKIP sub-marker — so an unprovisioned sandbox can never block every push
// NOR masquerade as a green check. These tests spawn the real script with a
// fetch stub (loaded via `node --import`, so it patches globalThis.fetch
// before the gate's top-level await runs) and lock the verdict end to end:
// the skip path exits 0, prints the loud SKIP lines, emits the marker, makes
// zero Firestore document calls, and production-fallback mode STILL hard-fails
// on the same error (production Auth is provisioned — an absence there is a
// genuine regression).

// The stub: answers every Identity Toolkit signUp with the sandbox's
// unprovisioned error and records every URL it saw to FETCH_STUB_LOG, so the
// tests can assert the skip path never touches Firestore documents. Anything
// else the gate tries on the skip path is unexpected → 500 (the test would
// fail loudly rather than silently pass).
const STUB = `
import { appendFileSync } from 'node:fs';
const log = process.env.FETCH_STUB_LOG;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (log) { try { appendFileSync(log, u + '\\n'); } catch {} }
  if (u.includes('identitytoolkit.googleapis.com/v1/accounts:signUp')) {
    return { ok: false, status: 400, json: async () => ({ error: { code: 400, message: 'CONFIGURATION_NOT_FOUND' } }) };
  }
  return { ok: false, status: 500, json: async () => ({ error: { message: 'UNEXPECTED_FETCH' } }) };
};
`;

const runGate = (overrides: Record<string, string>, opts?: { isolatedCwd?: boolean }) => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-skip-'));
  const stub = join(dir, 'fetch-stub.mjs');
  const log = join(dir, 'urls.log');
  writeFileSync(stub, STUB);
  // Start from the real env but guarantee sandbox mode is decided by the
  // test's overrides alone — a dev shell exporting VERIFY_FIREBASE_* must not
  // flip test 3 (production fallback) by accident.
  const env = { ...process.env, FETCH_STUB_LOG: log };
  delete env.VERIFY_FIREBASE_PROJECT_ID;
  delete env.VERIFY_FIREBASE_WEB_API_KEY;
  // isolatedCwd runs the gate from a temp dir with no .env.local, so the
  // production-fallback test really is production mode (readLocalEnv resolves
  // .env.local from cwd) rather than silently inheriting the real sandbox
  // vars from the repo's .env.local.
  const cwd = opts?.isolatedCwd ? dir : process.cwd();
  const res = spawnSync('node', ['--import', stub, join(process.cwd(), 'scripts', 'verify-firestore-rules.mjs')], {
    cwd,
    env: { ...env, ...overrides },
    encoding: 'utf8',
    timeout: 60_000,
  });
  const urls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  rmSync(dir, { recursive: true, force: true });
  return { status: res.status, out: `${res.stdout ?? ''}\n${res.stderr ?? ''}`, urls };
};

const SANDBOX_VARS = {
  VERIFY_FIREBASE_PROJECT_ID: 'portfolio-app-freebuff-verify',
  VERIFY_FIREBASE_WEB_API_KEY: 'fake-key-for-test',
};

describe('verify-firestore-rules · sandbox-auth SKIP verdict', () => {
  it('reports a loud SKIP and exits 0 when the sandbox Auth is unprovisioned (CONFIGURATION_NOT_FOUND)', () => {
    const { status, out } = runGate(SANDBOX_VARS);
    expect(status).toBe(0);
    expect(out).toContain('✗ SKIP: sandbox Auth not provisioned (CONFIGURATION_NOT_FOUND)');
    expect(out).toContain('production read quota untouched');
    expect(out).toContain('VERIFY-SUBRESULT|sandbox-auth|SKIP');
    expect(out).toContain('RESULT: SKIP');
  });

  it('makes zero Firestore document calls on the skip path (only the signUp probe)', () => {
    const { urls } = runGate(SANDBOX_VARS);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u).not.toContain('firestore.googleapis.com/v1/projects/');
    }
    expect(urls.every((u) => u.includes('identitytoolkit.googleapis.com/v1/accounts:signUp'))).toBe(true);
  });

  it('still hard-fails on CONFIGURATION_NOT_FOUND in production fallback mode (a real anomaly, not a skip)', () => {
    // Production fallback from an isolated cwd (no .env.local to inherit the
    // sandbox vars from) with explicit production credentials: the same
    // CONFIGURATION_NOT_FOUND error there is NOT a skip — production Auth is
    // provisioned, so an absence is a genuine regression that must block.
    const { status, out } = runGate({
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'portfolio-app-freebuff2',
      FIREBASE_WEB_API_KEY: 'fake-prod-key',
    }, { isolatedCwd: true });
    expect(status).toBe(1);
    expect(out).toContain('could not mint a test user');
  });
});
