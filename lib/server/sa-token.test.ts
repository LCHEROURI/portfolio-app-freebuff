import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The module (lib/server/sa-token.mjs) resolves credentials from process.env,
// then a .env.local file in cwd, then a FIREBASE_SERVICE_ACCOUNT_PATH file,
// and caches the minted token in module scope. Each test runs in its own temp
// cwd with a crafted .env.local and loads a FRESH module instance (via
// vi.resetModules + dynamic import), so credential resolution and the token
// cache are fully isolated — no node:fs/node:crypto mocking required.

const unsetAuthEnv = () => {
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_PROJECT_ID;
};

const REAL_CWD = process.cwd();
let tempDir: string;

beforeEach(() => {
  unsetAuthEnv();
  tempDir = mkdtempSync(join(tmpdir(), 'sa-token-test-'));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(REAL_CWD);
  rmSync(tempDir, { recursive: true, force: true });
  unsetAuthEnv();
  vi.unstubAllGlobals();
});

/** Fresh module instance (resets the cached mint token between tests). */
const loadTokenModule = async () => {
  vi.resetModules();
  return await import('./sa-token.mjs');
};

/** A real RSA private key so the actual JWT signing path executes. */
const makeSaJson = () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({
    client_email: 'sa@test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
};

const stubTokenFetch = () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'tok-abc' }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('getServiceAccount — credential resolution precedence', () => {
  it('prefers the FIREBASE_SERVICE_ACCOUNT env var over .env.local', async () => {
    const mod = await loadTokenModule();
    process.env.FIREBASE_SERVICE_ACCOUNT = 'env-sa';
    writeFileSync(join(tempDir, '.env.local'), 'FIREBASE_SERVICE_ACCOUNT=dotenv-sa\n');
    expect(mod.getServiceAccount()).toBe('env-sa');
  });

  it('falls back to .env.local before consulting FIREBASE_SERVICE_ACCOUNT_PATH', async () => {
    const mod = await loadTokenModule();
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = join(tempDir, 'sa.json');
    writeFileSync(join(tempDir, '.env.local'), [
      'FIREBASE_SERVICE_ACCOUNT=dotenv-sa',
      `FIREBASE_SERVICE_ACCOUNT_PATH=${join(tempDir, 'sa.json')}`,
    ].join('\n'));
    writeFileSync(join(tempDir, 'sa.json'), 'path-sa');
    expect(mod.getServiceAccount()).toBe('dotenv-sa');
  });

  it('reads the FIREBASE_SERVICE_ACCOUNT_PATH file when env and .env.local lack the JSON', async () => {
    const mod = await loadTokenModule();
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = join(tempDir, 'sa.json');
    writeFileSync(join(tempDir, '.env.local'), `FIREBASE_SERVICE_ACCOUNT_PATH=${join(tempDir, 'sa.json')}\n`);
    writeFileSync(join(tempDir, 'sa.json'), 'path-sa');
    expect(mod.getServiceAccount()).toBe('path-sa');
  });

  it('returns "" when nothing is configured', async () => {
    const mod = await loadTokenModule();
    writeFileSync(join(tempDir, '.env.local'), 'CRON_SECRET=x\n');
    expect(mod.getServiceAccount()).toBe('');
  });
});

describe('getProjectId — precedence', () => {
  it('prefers NEXT_PUBLIC_FIREBASE_PROJECT_ID over FIREBASE_PROJECT_ID', async () => {
    const mod = await loadTokenModule();
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'pub-project';
    process.env.FIREBASE_PROJECT_ID = 'server-project';
    expect(mod.getProjectId()).toBe('pub-project');
  });

  it('falls back to FIREBASE_PROJECT_ID, then .env.local', async () => {
    const mod = await loadTokenModule();
    // NEXT_PUBLIC unset everywhere → FIREBASE_PROJECT_ID env wins.
    process.env.FIREBASE_PROJECT_ID = 'server-project';
    expect(mod.getProjectId()).toBe('server-project');

    // Neither env var set → .env.local NEXT_PUBLIC line wins.
    unsetAuthEnv();
    writeFileSync(join(tempDir, '.env.local'), 'NEXT_PUBLIC_FIREBASE_PROJECT_ID=dotenv-project\n');
    expect(mod.getProjectId()).toBe('dotenv-project');
  });
});

describe('isServiceAccountConfigured', () => {
  it('is true only when both the SA and a project id resolve', async () => {
    const mod = await loadTokenModule();
    process.env.FIREBASE_SERVICE_ACCOUNT = 'env-sa';
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'pub-project';
    expect(mod.isServiceAccountConfigured()).toBe(true);

    unsetAuthEnv();
    expect(mod.isServiceAccountConfigured()).toBe(false);
  });
});

describe('mintServiceAccountToken — cached mint', () => {
  it('mints once and serves the cached token on the next call', async () => {
    const mod = await loadTokenModule();
    process.env.FIREBASE_SERVICE_ACCOUNT = makeSaJson();
    const fetchMock = stubTokenFetch();

    const first = await mod.mintServiceAccountToken();
    const second = await mod.mintServiceAccountToken();

    expect(first).toBe('tok-abc');
    expect(second).toBe('tok-abc');
    // Second call came from the module cache — the token endpoint hit once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the --service-account override even when the env is unset', async () => {
    const mod = await loadTokenModule();
    const fetchMock = stubTokenFetch();

    const token = await mod.mintServiceAccountToken(makeSaJson());

    expect(token).toBe('tok-abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when no service account is configured', async () => {
    const mod = await loadTokenModule();
    writeFileSync(join(tempDir, '.env.local'), 'CRON_SECRET=x\n');
    await expect(mod.mintServiceAccountToken()).rejects.toThrow(/not configured/);
  });

  it('throws when the token endpoint fails', async () => {
    const mod = await loadTokenModule();
    process.env.FIREBASE_SERVICE_ACCOUNT = makeSaJson();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    await expect(mod.mintServiceAccountToken()).rejects.toThrow(/token mint failed/);
  });
});
