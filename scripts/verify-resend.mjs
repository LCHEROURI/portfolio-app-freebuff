#!/usr/bin/env node
// ============================================================================
// scripts/verify-resend.mjs — prove the stored RESEND_API_KEY is alive and
// can authenticate to the Resend API, so a revoked or mistyped key is caught
// before it silently breaks the Automation Engine's emailed reports. Also
// asserts the report sender (REPORT_FROM) is a verified custom domain, not
// the onboarding@resend.dev sandbox the app defaults to.
//
// Reads RESEND_API_KEY from:
//   1. the RESEND_API_KEY env var
//   2. .env.local (RESEND_API_KEY=…)
//
// Probes GET https://api.resend.com/api-keys with the key as a Bearer token
// — a pure, read-only health check that sends no email:
//   - 200                          → full-access key, valid
//   - 401 { name: 'restricted_api_key' } → key is authentic but send-only
//     (Resend restricts it to sending emails) — exactly the permission the
//     Automation Engine needs, so it counts as PASS with a note
//   - 400/401/403 (anything else)  → key is invalid or revoked — exit 2 with
//     the paste-a-fresh-key guidance, mirroring the Vercel token gates'
//     rc=2 contract so the pre-push hook's invalid-credential branch treats
//     it identically
//   - any other status / network  → exit 1 (cannot verify either way)
//
// Reads REPORT_FROM from the same sources and asserts it points at a verified
// custom domain (NOT onboarding@resend.dev):
//   - unset                        → the app falls back to the sandbox sender
//                                     — exit 2 with configure-a-domain guidance
//   - @resend.dev                  → still the sandbox sender — exit 2
//   - custom domain                → DNS TXT probe (read-only, sends no email):
//                                     SPF (v=spf1 include:amazonses.com) +
//                                     DKIM (resend._domainkey …v=DKIM1…)
//                                     present → PASS; missing records → exit 2
//                                     with the exact records to add; DNS probe
//                                     network failure → exit 1 (cannot verify)
//
// Usage:
//   npm run verify:resend              # against the stored RESEND_API_KEY
//   node scripts/verify-resend.mjs
//   node scripts/verify-resend.mjs --domain yourname.com   # DNS pre-flight only:
//                                    # probes a candidate sender domain's TXT
//                                    # records WITHOUT touching REPORT_FROM —
//                                    # check the domain is Resend-ready before
//                                    # wiring it anywhere. Exit 0 = verified,
//                                    # 2 = missing/invalid, 1 = cannot verify.
//
// Exports (for the unit test): readResendKey, readReportFrom,
// fetchResendKeyStatus, classifyResendKey, classifyReportFrom, probeDomainDns,
// classifySenderDomain, validateDomainInput, classifyPreflightDomain.
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveTxt } from 'node:dns/promises';

const RESEND_BASE = 'https://api.resend.com';

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : '';
};
const PREFLIGHT_DOMAIN = flagValue('--domain');

/**
 * Read a stored value from the env var, then .env.local (never printed).
 * Returns '' when absent. Shared by the key and REPORT_FROM resolvers.
 */
const readEnv = (name) => {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    const m = env.match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^"|"$/g, '') : '';
  } catch {
    return '';
  }
};

/**
 * Read the stored Resend API key from env, then .env.local.
 * Returns '' when absent.
 */
export function readResendKey() {
  return readEnv('RESEND_API_KEY');
}

/**
 * Read the stored report sender (REPORT_FROM) from env, then .env.local.
 * Returns '' when absent — the app then falls back to the sandbox sender
 * 'Command Center <onboarding@resend.dev>'.
 */
export function readReportFrom() {
  return readEnv('REPORT_FROM');
}

/**
 * Probe the Resend key-list endpoint. Returns { res, body } so callers can
 * inspect status and the parsed body — kept as its own function so the unit
 * test can mock fetch and assert the endpoint + auth header.
 */
export async function fetchResendKeyStatus(key, base = RESEND_BASE) {
  const res = await fetch(`${base}/api-keys`, {
    headers: { authorization: `Bearer ${key}` },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => null);
  return { res, body };
}

/**
 * Pure classification of a Resend /api-keys probe, extracted from main() so
 * it is unit-testable:
 *   { kind: 'valid-full' }     — HTTP 200, full-access key
 *   { kind: 'valid-sendonly' } — HTTP 401 + name 'restricted_api_key':
 *                                authentic key restricted to sending emails
 *   { kind: 'invalid' }        — HTTP 400/401/403 otherwise: bad/revoked key
 *   { kind: 'unknown' }        — any other status (e.g. 5xx) — can't verify
 */
export function classifyResendKey(status, body = {}) {
  if (status === 200) return { kind: 'valid-full' };
  if (status === 401 && body?.name === 'restricted_api_key') return { kind: 'valid-sendonly' };
  if (status === 400 || status === 401 || status === 403) return { kind: 'invalid' };
  return {
    kind: 'unknown',
    status,
    detail: typeof body?.message === 'string' ? body.message : '',
  };
}

/**
 * Pure classification of a REPORT_FROM value:
 *   { kind: 'unset' }          — empty: the app uses the sandbox sender
 *   { kind: 'sandbox', … }     — address on resend.dev (the sandbox)
 *   { kind: 'custom', … }      — address on a user's own domain
 *   { kind: 'malformed', raw } — no parseable email address
 */
export function classifyReportFrom(value = '') {
  const v = (value || '').trim();
  if (!v) return { kind: 'unset' };
  // Prefer the angle-bracketed address ("Name <email@domain>"), so a display
  // name that itself contains an '@' cannot shadow the real sender; only when
  // no bracketed address exists fall back to a bare "email@domain" form.
  const m = v.match(/<\s*([^<>\s]+@([^<>\s]+))\s*>/) ?? v.match(/([^<>\s]+@([^<>\s]+))/);
  if (!m) return { kind: 'malformed', raw: v };
  const email = m[1];
  const domain = m[2].toLowerCase();
  if (domain === 'resend.dev' || domain.endsWith('.resend.dev')) {
    return { kind: 'sandbox', email, domain };
  }
  return { kind: 'custom', email, domain };
}

/**
 * Probe a domain's DNS for the TXT records Resend requires for sending:
 *   - SPF  at the domain root:  'v=spf1 … include:amazonses.com …'
 *     (Resend sends through Amazon SES, so the SPF include is amazonses.com)
 *   - DKIM at resend._domainkey.<domain>:  'v=DKIM1; k=rsa; p=…'
 *   - DMARC at _dmarc.<domain>: 'v=DMARC1; …' (optional — reported, not
 *     required for verification)
 *
 * Returns { spf, dkim, dmarc, error }. A probe-level failure on the ROOT
 * lookup (network, NXDOMAIN for the domain itself) sets error so the caller
 * can report 'cannot verify' instead of a false negative; a missing DKIM or
 * DMARC record is simply false (those records legitimately may not exist yet).
 * The resolver is injectable for tests (defaults to node's resolveTxt).
 */
export async function probeDomainDns(domain, resolver = resolveTxt) {
  const probe = { spf: false, dkim: false, dmarc: false, error: '' };
  try {
    const root = await resolver(domain);
    probe.spf = root.some((chunks) => {
      const txt = chunks.join('');
      return txt.includes('v=spf1') && txt.includes('amazonses.com');
    });
  } catch (err) {
    // ENODATA = the domain resolves but has no TXT record at all — a genuine
    // missing-SPF state (unverified), not a probe failure. Everything else
    // (NXDOMAIN/ENOTFOUND for the domain itself, timeouts, network) means the
    // domain cannot be verified either way.
    if (err?.code !== 'ENODATA') {
      probe.error = err?.code || err?.message || 'DNS root lookup failed';
    }
    return probe;
  }
  try {
    const dkim = await resolver(`resend._domainkey.${domain}`);
    probe.dkim = dkim.some((chunks) => chunks.join('').includes('v=DKIM1'));
  } catch (err) {
    // ENODATA/ENOTFOUND = the DKIM record does not exist yet → stays false.
    if (err?.code !== 'ENODATA' && err?.code !== 'ENOTFOUND' && err?.code !== 'NXDOMAIN') {
      probe.error = err?.code || err?.message || 'DNS DKIM lookup failed';
    }
  }
  try {
    const dmarc = await resolver(`_dmarc.${domain}`);
    probe.dmarc = dmarc.some((chunks) => chunks.join('').includes('v=DMARC1'));
  } catch {
    // DMARC is optional — absence is not an error.
  }
  return probe;
}

/**
 * Combine the REPORT_FROM classification with the DNS probe result:
 *   unset / sandbox / malformed pass through as-is
 *   custom + probe error        → { kind: 'cannot-verify', error }
 *   custom + SPF & DKIM present → { kind: 'verified', dmarc }
 *   custom + missing records    → { kind: 'unverified', spf, dkim }
 */
export function classifySenderDomain(reportFrom, probe) {
  const parsed = classifyReportFrom(reportFrom);
  if (parsed.kind !== 'custom') return parsed;
  if (probe.error) return { ...parsed, kind: 'cannot-verify', error: probe.error };
  if (probe.spf && probe.dkim) return { ...parsed, kind: 'verified', dmarc: probe.dmarc };
  return { ...parsed, kind: 'unverified', spf: probe.spf, dkim: probe.dkim };
}

/**
 * Validate a bare candidate domain for the --domain pre-flight. Returns an
 * error message, or null when the input looks like a domain (labels of
 * alphanumerics/hyphens separated by dots). Rejects emails, sandbox domains,
 * and junk — so a mistyped `--domain reports@yourname.com` is caught with
 * guidance instead of a confusing DNS NXDOMAIN.
 */
export function validateDomainInput(value = '') {
  const v = (value || '').trim().toLowerCase();
  if (!v) return 'empty domain';
  if (v.includes('@') || v.includes('<') || v.includes('>') || /\s/.test(v)) {
    return 'looks like an email or "Name <email>" — pass the BARE domain, e.g. --domain yourname.com';
  }
  if (v === 'resend.dev' || v.endsWith('.resend.dev')) {
    return 'resend.dev is the sandbox — pre-flight a real domain you own';
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v)) {
    return `'${value}' is not a plausible domain (expected labels separated by dots, e.g. yourname.com)`;
  }
  return null;
}

/**
 * Verdict for the --domain pre-flight, derived from a probeDomainDns result:
 *   { kind: 'verified', dmarc }       — SPF + DKIM present (Resend-ready)
 *   { kind: 'unverified', spf, dkim } — a required record is missing
 *   { kind: 'cannot-verify', error }  — DNS probe network failure
 */
export function classifyPreflightDomain(probe) {
  if (probe.error) return { kind: 'cannot-verify', error: probe.error };
  if (probe.spf && probe.dkim) return { kind: 'verified', dmarc: probe.dmarc };
  return { kind: 'unverified', spf: probe.spf, dkim: probe.dkim };
}

async function main() {
  // ── 0. DNS pre-flight (--domain) — no key, no REPORT_FROM ─────────────────
  // Probes a candidate sender domain's TXT records standalone, so the domain
  // can be checked for Resend readiness BEFORE it is wired into REPORT_FROM
  // anywhere. Same exit-code contract as the sender check: 0 = verified,
  // 2 = missing/invalid domain, 1 = DNS probe could not verify.
  if (PREFLIGHT_DOMAIN) {
    const invalid = validateDomainInput(PREFLIGHT_DOMAIN);
    if (invalid) {
      console.error(`✗ FAIL: ${invalid}`);
      console.error('\nRESULT: FAIL — nothing was probed (bad --domain value).');
      process.exit(2);
    }
    console.log('\nSender domain DNS pre-flight (--domain)');
    console.log(`  domain    ${PREFLIGHT_DOMAIN.toLowerCase()}`);
    const probe = await probeDomainDns(PREFLIGHT_DOMAIN.toLowerCase());
    const verdict = classifyPreflightDomain(probe);
    if (verdict.kind === 'cannot-verify') {
      console.error(`  verdict   could not probe DNS (${verdict.error}) — the domain may not`);
      console.error('            exist or the resolver is unreachable.');
      console.error('\nRESULT: FAIL — cannot verify the domain.');
      process.exit(1);
    }
    if (verdict.kind === 'unverified') {
      console.error(`  verdict   NOT ready for Resend sending`);
      console.error(`            SPF  ${probe.spf ? '✓ found' : '✗ missing — TXT @ v=spf1 include:amazonses.com ~all'}`);
      console.error(`            DKIM ${probe.dkim ? '✓ found' : '✗ missing — TXT resend._domainkey v=DKIM1; k=rsa; p=…'}`);
      console.error('  fix       add the missing TXT records at your DNS provider, click Verify');
      console.error('            in the Resend dashboard, then re-run this pre-flight.');
      console.error('\nRESULT: FAIL — the domain is not verified for Resend sending.');
      process.exit(2);
    }
    console.log(`  verdict   ✓ ready for Resend sending`);
    console.log(`            SPF ✓ · DKIM ✓ · DMARC ${probe.dmarc ? '✓' : 'optional (missing)'}`);
    console.log('\nRESULT: PASS — safe to wire into REPORT_FROM (npm run wire:report-from).');
    process.exit(0);
  }

  // ── 1. Resend API key health ───────────────────────────────────────────────
  const key = readResendKey();
  if (!key) {
    console.error('✗ FAIL: no RESEND_API_KEY (set RESEND_API_KEY or add it to .env.local)');
    process.exit(1);
  }
  if (!key.startsWith('re_')) {
    console.error('✗ FAIL: RESEND_API_KEY does not look like a Resend key (expected re_ prefix)');
    process.exit(1);
  }

  let res;
  let body;
  try {
    ({ res, body } = await fetchResendKeyStatus(key));
  } catch (err) {
    console.error(`✗ FAIL: could not reach the Resend API (${err.message})`);
    process.exit(1);
  }

  const verdict = classifyResendKey(res.status, body);

  console.log('\nResend API key health');
  console.log(`  endpoint  GET /api-keys → HTTP ${res.status}`);

  if (verdict.kind === 'valid-full') {
    console.log('  verdict   key is valid (full access)');
  } else if (verdict.kind === 'valid-sendonly') {
    console.log('  verdict   key is valid — send-only (restricted to sending emails, which is');
    console.log('            exactly what the Automation Engine needs)');
  } else if (verdict.kind === 'invalid') {
    console.error('  verdict   key is invalid or revoked');
    console.error('  fix       create a fresh key at https://resend.com/api-keys, then set it in');
    console.error('            .env.local AND Vercel production (RESEND_API_KEY), and redeploy');
    console.error('\nRESULT: FAIL — the stored RESEND_API_KEY is not accepted by the Resend API.');
    process.exit(2);
  } else {
    console.error(`  verdict   cannot verify — HTTP ${verdict.status}${verdict.detail ? ` (${verdict.detail})` : ''}`);
    console.error('\nRESULT: FAIL — the Resend API did not answer authoritatively.');
    process.exit(1);
  }
  console.log('  → key health PASS');

  // ── 2. Report sender domain (REPORT_FROM) ──────────────────────────────────
  const reportFrom = readReportFrom();
  const displayFrom = reportFrom
    ? `'${reportFrom}'`
    : '<unset — app falls back to Command Center <onboarding@resend.dev>>';
  console.log('\nReport sender domain (REPORT_FROM)');
  console.log(`  sender    ${displayFrom}`);
  // NOTE: this gate intentionally stays RED until REPORT_FROM points at a
  // verified custom domain. The sandbox sender (the unset default) can only
  // reach the account owner's own verified address, so leaving it unset is a
  // go-live blocker, not a skip.

  const sender = classifyReportFrom(reportFrom);
  if (sender.kind === 'unset') {
    console.error('  verdict   REPORT_FROM is not set — reports send from the sandbox sender');
    console.error('            onboarding@resend.dev, which can only reach your own verified');
    console.error('            address. Configure a sender domain and set REPORT_FROM.');
    console.error('\nRESULT: FAIL — REPORT_FROM must point at a verified sender domain.');
    process.exit(2);
  }
  if (sender.kind === 'sandbox') {
    console.error(`  verdict   ${sender.email} still uses the Resend sandbox sender (@resend.dev)`);
    console.error('  fix       add a domain at https://resend.com/domains, add the DNS records it');
    console.error('            generates, verify it, then set');
    console.error('            REPORT_FROM="Command Center <reports@yourdomain.com>"');
    console.error('            in .env.local AND Vercel production, then redeploy.');
    console.error('\nRESULT: FAIL — REPORT_FROM must point at a verified sender domain.');
    process.exit(2);
  }
  if (sender.kind === 'malformed') {
    console.error(`  verdict   could not parse a sender email from REPORT_FROM (${sender.raw})`);
    console.error('  fix       use "Name <email@yourdomain.com>" format.');
    console.error('\nRESULT: FAIL — REPORT_FROM is not a valid sender address.');
    process.exit(2);
  }

  const probe = await probeDomainDns(sender.domain);
  const senderVerdict = classifySenderDomain(reportFrom, probe);
  if (senderVerdict.kind === 'cannot-verify') {
    console.error(`  verdict   could not probe ${sender.domain} DNS (${senderVerdict.error})`);
    console.error('            — re-run when DNS resolves; the domain may not exist or');
    console.error('            the resolver is unreachable.');
    console.error('\nRESULT: FAIL — cannot verify the sender domain.');
    process.exit(1);
  }
  if (senderVerdict.kind === 'unverified') {
    console.error(`  verdict   ${sender.domain} is NOT set up for Resend sending`);
    console.error(`            SPF  ${probe.spf ? '✓ found' : '✗ missing — TXT @ v=spf1 include:amazonses.com ~all'}`);
    console.error(`            DKIM ${probe.dkim ? '✓ found' : '✗ missing — TXT resend._domainkey v=DKIM1; k=rsa; p=…'}`);
    console.error('  fix       add the missing TXT records at your DNS provider, click Verify in');
    console.error('            the Resend dashboard, wait for Verified, then re-run this gate.');
    console.error('\nRESULT: FAIL — the sender domain is not verified for Resend sending.');
    process.exit(2);
  }
  console.log(`  verdict   ${sender.domain} verified for Resend sending`);
  console.log(`            SPF ✓ · DKIM ✓ · DMARC ${probe.dmarc ? '✓' : 'optional (missing)'}`);

  console.log('\nRESULT: PASS');
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
