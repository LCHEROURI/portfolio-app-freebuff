#!/usr/bin/env node
/**
 * e2e/provenance.e2e.mjs — end-to-end provenance test for freebuff-car-app.
 *
 * Builds the app with deploy provenance baked in (the exact NEXT_PUBLIC_*
 * variables scripts/deploy-car-app.sh writes into .env.production for real
 * Firebase rollouts), serves the production build with `next start`, then
 * asserts over real HTTP:
 *
 *   1. GET /api/version returns 200 with the build's commit, rollout id, and
 *      deploy time — and the commit matches the expected HEAD.
 *   2. GET /status renders and reports "All checks passed" (not degraded,
 *      not a dev-build warning), echoing the same commit and rollout.
 *
 * Exits non-zero on any failure. Plain node — no extra test dependencies.
 *
 * Environment overrides:
 *   E2E_COMMIT_FULL    expected commit (default: current git HEAD)
 *   E2E_ROLLOUT_ID     rollout id to bake (default: e2e-local-<timestamp>)
 *   E2E_DEPLOYED_AT    deploy time to bake (default: now, ISO UTC)
 *   E2E_PORT           port for next start (default: 4321)
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAR_APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.E2E_PORT || '4321';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ENV_FILE = join(CAR_APP_DIR, '.env.production');

function gitHead() {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: CAR_APP_DIR, encoding: 'utf8' });
  if (res.status !== 0) {
    console.error('e2e: could not resolve git HEAD —', res.stderr.trim());
    process.exit(1);
  }
  return res.stdout.trim();
}

const COMMIT_FULL = process.env.E2E_COMMIT_FULL || gitHead();
const EXPECTED_COMMIT_FULL =
  process.env.E2E_EXPECT_COMMIT_FULL || COMMIT_FULL;
const ROLLOUT_ID = process.env.E2E_ROLLOUT_ID || `e2e-local-${Date.now()}`;
const DEPLOYED_AT = process.env.E2E_DEPLOYED_AT || new Date().toISOString();

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('e2e: building with baked provenance');
  console.log(`  commit    ${COMMIT_FULL}`);
  console.log(`  rollout   ${ROLLOUT_ID}`);
  console.log(`  deployed  ${DEPLOYED_AT}`);
  console.log('');

  // Bake provenance exactly like the deploy script does, and always clean
  // the file up so it can never leak into a commit.
  writeFileSync(
    ENV_FILE,
    `NEXT_PUBLIC_COMMIT_SHA=${COMMIT_FULL}\n` +
      `NEXT_PUBLIC_ROLLOUT_ID=${ROLLOUT_ID}\n` +
      `NEXT_PUBLIC_DEPLOYED_AT=${DEPLOYED_AT}\n`,
  );

  const build = spawnSync('npx', ['next', 'build'], {
    cwd: CAR_APP_DIR,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (build.status !== 0) {
    console.error('e2e: build failed');
    process.exitCode = build.status ?? 1;
    return;
  }

  console.log(`\ne2e: starting production server on ${ORIGIN}`);
  const server = spawn(
    process.platform === 'win32' ? 'npx' : join(CAR_APP_DIR, 'node_modules', '.bin', 'next'),
    process.platform === 'win32' ? ['next', 'start', '-p', PORT] : ['start', '-p', PORT],
    { cwd: CAR_APP_DIR, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let serverOutput = '';
  server.stdout.on('data', (d) => (serverOutput += d));
  server.stderr.on('data', (d) => (serverOutput += d));

  try {
    // Wait for readiness against /api/version itself.
    let versionRes = null;
    for (let waited = 0; waited < 30_000; waited += 500) {
      try {
        const res = await fetch(`${ORIGIN}/api/version`, { cache: 'no-store' });
        if (res.ok) {
          versionRes = res;
          break;
        }
      } catch {
        /* server not up yet */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!versionRes) {
      console.error('e2e: server never became ready. Server output:');
      console.error(serverOutput.slice(-2000));
      process.exitCode = 1;
      return;
    }

    console.log('\ne2e: GET /api/version');
    check('HTTP 200', versionRes.status === 200, `status ${versionRes.status}`);
    check(
      'Cache-Control: no-store',
      (versionRes.headers.get('cache-control') || '').includes('no-store'),
    );
    const version = await versionRes.json();
    check('service is freebuff-car-app', version.service === 'freebuff-car-app', version.service);
    check(
      'commitFull matches expected HEAD',
      version.commitFull === EXPECTED_COMMIT_FULL,
      `got ${version.commitFull}`,
    );
    check(
      'short commit is 7-char prefix',
      version.commit === EXPECTED_COMMIT_FULL.slice(0, 7),
      `got ${version.commit}`,
    );
    check('rolloutId matches build', version.rolloutId === ROLLOUT_ID, version.rolloutId);
    check('deployedAt matches build', version.deployedAt === DEPLOYED_AT, version.deployedAt);

    console.log('\ne2e: GET /status');
    const statusRes = await fetch(`${ORIGIN}/status`, { cache: 'no-store' });
    check('HTTP 200', statusRes.status === 200, `status ${statusRes.status}`);
    const html = await statusRes.text();
    check('reports "All checks passed"', html.includes('All checks passed'));
    check('not degraded', !html.includes('Degraded'));
    check(
      'no dev-build provenance warning',
      !html.includes('not baked (dev build)'),
    );
    check(
      'status echoes the served commit',
      html.includes(EXPECTED_COMMIT_FULL.slice(0, 7)),
    );
    check('status echoes the rollout id', html.includes(ROLLOUT_ID));
  } finally {
    server.kill('SIGTERM');
    setTimeout(() => {
      try {
        server.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, 1500).unref();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\ne2e: ${results.length - failed.length}/${results.length} assertions passed`,
  );
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  // Belt and braces: never leave the baked env file behind, even on a crash.
  if (existsSync(ENV_FILE)) rmSync(ENV_FILE);
}
