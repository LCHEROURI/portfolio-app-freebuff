/**
 * wire-google-client.mjs
 *
 * Swaps a *classic* Google web OAuth client (id format
 * `{projectNumber}-{hash}.apps.googleusercontent.com` + a `GOCSPX-…` secret)
 * into the Identity Platform `defaultSupportedIdpConfigs/google.com` record,
 * then verifies the swap at every layer:
 *
 *   1. admin API PATCH of clientId/clientSecret/enabled
 *   2. admin GET back (record round-trips)
 *   3. accounts.google.com recognizes the client id (the exact failure that
 *      occurs when a Workforce-style `gcloud iam oauth-clients` client is used)
 *   4. the SDK's `createAuthUri` embeds the classic client id
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=952213217375-xxxx.apps.googleusercontent.com \
 *   GOOGLE_CLIENT_SECRET=GOCSPX-... \
 *   node scripts/wire-google-client.mjs
 *
 * The classic client cannot be created programmatically (console only), so
 * this script only ever *consumes* values you paste from the GCP console
 * (Google Auth Platform → Clients → Create Client → Web application).
 */
import { fileURLToPath } from 'node:url';
import { mintServiceAccountToken } from '../lib/server/sa-token.mjs';
import { readLocalEnv } from './local-env.mjs';

export const CLASSIC_CLIENT_ID_RE = /^\d+-[\w-]+\.apps\.googleusercontent\.com$/;
// Real GOCSPX secrets are long; the placeholder template is short (`GOCSPX-xxxx`).
export const CLASSIC_SECRET_RE = /^GOCSPX-[A-Za-z0-9_-]{16,}$/;
// The README / prompts use `xxxx` / `REPLACE` as stand-ins — never a real hash.
const PLACEHOLDER_RE = /xxxx|replace/i;

/** True when the id looks like a real classic consumer web OAuth client id. */
export function isClassicWebClientId(clientId) {
  return (
    typeof clientId === 'string' &&
    CLASSIC_CLIENT_ID_RE.test(clientId) &&
    !PLACEHOLDER_RE.test(clientId)
  );
}

/** True when the secret looks like a real `GOCSPX-…` Google client secret. */
export function isClassicClientSecret(secret) {
  return typeof secret === 'string' && CLASSIC_SECRET_RE.test(secret);
}

const PROJ = 'portfolio-app-freebuff2';

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Usage: GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/wire-google-client.mjs');
    process.exit(1);
  }
  if (!isClassicWebClientId(clientId)) {
    console.error(`FATAL: client id "${clientId}" is not a classic web client (expected {projectNumber}-{hash}.apps.googleusercontent.com).`);
    console.error('       gcloud iam oauth-clients creates Workforce clients that accounts.google.com will NOT recognize.');
    process.exit(1);
  }
  if (!isClassicClientSecret(clientSecret)) {
    console.error(`FATAL: client secret does not look like a real GOCSPX-… secret (got "${String(clientSecret).slice(0, 12)}…").`);
    process.exit(1);
  }

  const token = await mintServiceAccountToken();
  const base = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJ}`;

  console.log('=== 1. PATCH google.com IdP record with classic client ===');
  const patchRes = await fetch(`${base}/defaultSupportedIdpConfigs/google.com?updateMask=clientId,clientSecret,enabled`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret, enabled: true }),
    cache: 'no-store',
  });
  const patchJson = await patchRes.json().catch(() => ({}));
  console.log('HTTP', patchRes.status);
  console.log(JSON.stringify({ enabled: patchJson.enabled, clientId: patchJson.clientId, clientSecret: patchJson.clientSecret ? '***' : 'MISSING' }, null, 1));
  if (patchRes.status !== 200) {
    console.log(JSON.stringify(patchJson).slice(0, 300));
    process.exit(1);
  }

  console.log('\n=== 2. admin GET round-trip ===');
  const getRes = await fetch(`${base}/defaultSupportedIdpConfigs/google.com`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  const getJson = await getRes.json().catch(() => ({}));
  console.log('HTTP', getRes.status, JSON.stringify({ enabled: getJson.enabled, clientId: getJson.clientId, secretSet: !!getJson.clientSecret }));
  if (getRes.status !== 200 || getJson.clientId !== clientId || !getJson.clientSecret) process.exit(1);

  console.log('\n=== 3. accounts.google.com recognizes the client ===');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', `https://${PROJ}.firebaseapp.com/__/auth/handler`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'select_account');
  const oauthRes = await fetch(url, {
    redirect: 'manual',
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Safari/537.36' },
    cache: 'no-store',
  });
  const loc = oauthRes.headers.get('location') || '';
  console.log('HTTP', oauthRes.status);
  if (loc.includes('authError')) {
    console.log('FAIL: Google OAuth rejects the client:', decodeURIComponent(loc.match(/authError=([^&]*)/)?.[1] || ''));
    process.exit(1);
  }
  console.log('OK: redirects to Google consent — client recognized:', loc.slice(0, 120));

  console.log('\n=== 4. SDK createAuthUri embeds the classic client ===');
  const key = readLocalEnv('NEXT_PUBLIC_FIREBASE_API_KEY') ?? '';
  const uriRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'probe@example.com', providerId: 'google.com', continueUri: `https://${PROJ}.firebaseapp.com` }),
    cache: 'no-store',
  });
  const uri = await uriRes.json();
  console.log('HTTP', uriRes.status, 'providerId:', uri.providerId ?? 'none');
  if (uri.authUri) {
    const u = new URL(uri.authUri);
    console.log('authUri client_id:', u.searchParams.get('client_id'));
    if (u.searchParams.get('client_id') !== clientId) {
      console.log('FAIL: authUri does not embed the classic client id');
      process.exit(1);
    }
  }

  console.log('\nRESULT: PASS — google.com now points at a classic web OAuth client.');
  console.log('Next: re-run `npm run verify:prod-signin` (or scripts/verify-prod-signin.mjs) end to end.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
