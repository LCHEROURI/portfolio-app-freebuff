#!/usr/bin/env node
// ============================================================================
// scripts/verify-sender-domain.mjs — confirm the report emails leave the
// Resend sandbox and carry a verified custom sender domain, end to end.
//
// Runs ONLY when REPORT_FROM points at a verified custom domain (the
// verify:resend gate enforces the same precondition; this gate goes further
// and proves the DEPLOYED app actually uses it):
//   1. Resolves REPORT_FROM (env → .env.local) and classifies it — the
//      sandbox sender (@resend.dev) or an unset value exits 2 immediately.
//   2. DNS-probes the domain with the same probe verify:resend uses
//      (probeDomainDns): SPF (v=spf1 include:amazonses.com) + DKIM
//      (resend._domainkey … v=DKIM1 …) must be present — a domain that is not
//      verified in Resend would be rejected by the send anyway.
//   3. Asserts the deployed Vercel production env carries the SAME
//      REPORT_FROM (vercel env pull — the from-header on real sends is set
//      server-side from that env). Skips-not-fails with a notice when
//      VERCEL_TOKEN or the vercel CLI is unavailable.
//   4. Triggers a REAL daily (or weekly) report against the deployed
//      /api/cron/reports (CRON_SECRET auth) and asserts Resend accepted the
//      send (sent:true + emailId). Resend only accepts a custom from-domain
//      after its DNS verification — a returned emailId is the live proof the
//      domain is verified and delivery reached the queue for REPORT_EMAIL.
//
// Usage:
//   npm run verify:sender-domain                          # daily report
//   npm run verify:sender-domain -- --kind weekly         # weekly report
//   node scripts/verify-sender-domain.mjs --base http://localhost:3000 \
//     --secret "$CRON_SECRET"
//
// Reads CRON_SECRET from --secret, then CRON_SECRET env, then .env.local;
// REPORT_FROM from --from, then REPORT_FROM env, then .env.local; the Vercel
// token from readToken (env → .env.local → CLI store, same as the other
// Vercel gates).
//
// Exit codes: 0 = PASS (verified domain, deployed env matches, real send
// accepted), 1 = verification failure (drift / send rejected / network),
// 2 = config gap (REPORT_FROM unset, sandbox, malformed, or the domain is
// not DNS-verified) — the same contract verify:resend uses.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyReportFrom,
  probeDomainDns,
  readReportFrom,
} from './verify-resend.mjs';
import { parseEnvFile } from './verify-vercel-env.mjs';
import { readToken } from './verify-deployed-hash.mjs';

const PRODUCTION_URL = 'https://portfolio-app-freebuff.vercel.app';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = (flag('--base', process.env.VERIFY_BASE_URL) ?? PRODUCTION_URL).replace(/\/$/, '');
const KIND = flag('--kind', 'daily');
const FROM = flag('--from', '') || readReportFrom();
const SECRET =
  flag('--secret') ??
  process.env.CRON_SECRET ??
  (() => {
    try {
      const env = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
      const m = env.match(/^CRON_SECRET=(.*)$/m);
      return m ? m[1].trim().replace(/^"|"$/g, '') : '';
    } catch {
      return '';
    }
  })();

if (KIND !== 'daily' && KIND !== 'weekly') {
  console.error(`✗ FAIL: --kind must be 'daily' or 'weekly', got '${KIND}'`);
  process.exit(2);
}

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  ✗ FAIL: ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

/** Pure helper: does the cron JSON report a real accepted send? Exported for tests. */
export const assertSendResponse = (body) => {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'non-object response' };
  if (body.sent === true && typeof body.emailId === 'string' && body.emailId) {
    return { ok: true, emailId: body.emailId };
  }
  return {
    ok: false,
    reason: body?.reason || body?.message || `sent=${body?.sent}, emailId=${body?.emailId ?? 'missing'}`,
  };
};

/** Resolve the vercel CLI binary: `vercel`, else `npx --yes vercel`. */
const vercelCmd = () => {
  try {
    execFileSync('vercel', ['--version'], { stdio: 'ignore' });
    return ['vercel'];
  } catch {
    return ['npx', '--yes', 'vercel'];
  }
};

const main = async () => {
  console.log(`\nReport sender domain confirmation — ${KIND} report against ${BASE}`);

  // ── 1. Sender resolution + classification ────────────────────────────────
  if (!FROM) {
    fail('REPORT_FROM is not set — reports still send from the sandbox sender (onboarding@resend.dev).');
    fail('Wire a verified domain first: npm run wire:report-from -- --from "Command Center <reports@yourdomain.com>"');
    console.error('\nRESULT: FAIL (sender not configured)');
    process.exit(2);
  }
  const sender = classifyReportFrom(FROM);
  if (sender.kind === 'sandbox' || sender.kind === 'unset') {
    fail(`'${FROM}' is the Resend sandbox sender (@resend.dev) — the confirmation exists to prove you left it.`);
    console.error('\nRESULT: FAIL (sandbox sender)');
    process.exit(2);
  }
  if (sender.kind === 'malformed') {
    fail(`could not parse a sender email from '${FROM}' — use "Name <email@yourdomain.com>"`);
    console.error('\nRESULT: FAIL (malformed sender)');
    process.exit(2);
  }
  ok(`sender resolves to custom domain ${sender.domain}`);

  // ── 2. DNS verification of the domain ────────────────────────────────────
  console.log('\n[1/3] Domain DNS verification');
  const probe = await probeDomainDns(sender.domain);
  if (probe.error) {
    fail(`could not probe ${sender.domain} DNS (${probe.error}) — the domain may not exist or the resolver is unreachable`);
    console.error('\nRESULT: FAIL (cannot verify domain)');
    process.exit(1);
  }
  if (!probe.spf || !probe.dkim) {
    fail(`${sender.domain} is NOT verified for Resend sending:`);
    fail(`  SPF  ${probe.spf ? '✓' : '✗'}  DKIM  ${probe.dkim ? '✓' : '✗'}`);
    fail('Add the TXT records at your DNS provider, click Verify in Resend, then re-run.');
    console.error('\nRESULT: FAIL (domain not DNS-verified)');
    process.exit(2);
  }
  ok(`domain verified in DNS — SPF ✓ · DKIM ✓ · DMARC ${probe.dmarc ? '✓' : 'optional (missing)'}`);

  // ── 3. Deployed env carries the same sender (from-header is server-set) ──
  console.log('\n[2/3] Deployed Vercel production env');
  const token = readToken();
  let deployedFrom = null;
  let tmp = null;
  if (!token) {
    console.log('  · VERCEL_TOKEN unavailable — skipping deployed-env comparison');
  } else {
    try {
      tmp = join(tmpdir(), `verify-sender-domain-${process.pid}-${Date.now()}.env`);
      execFileSync(...vercelCmd(), ['env', 'pull', tmp, '--environment=production', '--yes'], {
        encoding: 'utf8',
        env: { ...process.env, VERCEL_TOKEN: token },
        timeout: 90_000,
      });
      deployedFrom = parseEnvFile(readFileSync(tmp, 'utf8')).get('REPORT_FROM') ?? '';
    } catch (err) {
      console.log(`  · vercel env pull failed (${String(err?.stderr ?? err?.message ?? err).split('\n')[0].slice(0, 200)}) — skipping deployed-env comparison`);
    } finally {
      if (tmp) rmSync(tmp, { force: true });
    }
  }
  if (deployedFrom !== null) {
    if (deployedFrom === FROM) {
      ok('deployed REPORT_FROM matches the resolved sender — the from-header on real sends is the verified domain');
    } else {
      fail(`deployed REPORT_FROM (${deployedFrom ? `len ${deployedFrom.length}` : 'unset'}) differs from local '${FROM}'. Set REPORT_FROM on Vercel production and redeploy.`);
      console.error('\nRESULT: FAIL (deployed env drift)');
      process.exit(1);
    }
  }

  // ── 4. Real send to the inbox ─────────────────────────────────────────────
  console.log(`\n[3/3] Real ${KIND} report send (Resend delivery)`);
  if (!SECRET) {
    fail('no CRON_SECRET available (pass --secret, set CRON_SECRET env, or .env.local)');
    console.error('\nRESULT: FAIL (no secret)');
    process.exit(1);
  }
  const res = await fetch(`${BASE}/api/cron/reports?kind=${KIND}`, {
    headers: { authorization: `Bearer ${SECRET}` },
    cache: 'no-store',
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON (e.g. HTML error page)
  }
  if (res.status === 401) {
    fail(`deployed CRON_SECRET differs from the value provided (401) — resync .env.local, Vercel, and the GitHub secret together.`);
    console.error('\nRESULT: FAIL (secret drift)');
    process.exit(1);
  }
  const verdict = assertSendResponse(body);
  if (!verdict.ok) {
    fail(`real ${KIND} send was not accepted: ${verdict.reason}`);
    console.error(`\nRESULT: FAIL (send rejected)`);
    process.exit(1);
  }
  ok(`real ${KIND} send accepted — emailId ${verdict.emailId}`);
  ok(`from-header = '${FROM}' · recipient = REPORT_EMAIL (see the email in your inbox)`);

  console.error(`\nRESULT: PASS`);
  process.exit(0);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`✗ FAIL: ${err.message}`);
    process.exit(1);
  });
}
