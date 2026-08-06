#!/usr/bin/env node
// ============================================================================
// scripts/wire-report-from.mjs — set REPORT_FROM (the report sender address)
// in all three stores at once so the verify:resend gate flips green:
//   1. .env.local                    (local pre-push hook + local runs)
//   2. Vercel production env         (the deployed app's cron sends from it)
//   3. GitHub Actions secret         (the verify-deployed CI job reads it)
//
// The script PREFLIGHTS the sender domain first with the same DNS TXT probe
// verify:resend uses (scripts/verify-resend.mjs exports probeDomainDns): the
// domain must already carry Resend's SPF (v=spf1 include:amazonses.com) and
// DKIM (resend._domainkey … v=DKIM1 …) records, i.e. it must be verified in
// the Resend dashboard. A sandbox-bound (@resend.dev) or unverified sender is
// rejected — you cannot wire the app back onto onboarding@resend.dev.
//
// Usage:
//   node scripts/wire-report-from.mjs --from "Command Center <reports@yourdomain.com>"
//   node scripts/wire-report-from.mjs --from "..." --dry-run     # preview only
//   node scripts/wire-report-from.mjs --from "..." --skip-dns    # only for DNS
//                                                                 # propagation lag —
//                                                                 # verify:resend still
//                                                                 # re-probes as the gate
//   node scripts/wire-report-from.mjs --from "..." --repo OWNER/REPO
//
// Requires the vercel CLI (for the env write) and gh (for the Actions
// secret). When a CLI is MISSING the script prints the manual command and
// continues (skip-not-fail) — a machine without them still updates .env.local
// and shows what remains. When a CLI is present but the command FAILS (e.g. a
// revoked token), the script exits 1: a partial write (one store updated, the
// others not) must not look like success. Reads VERCEL_TOKEN from env →
// .env.local when the CLI store isn't logged in; --token is only passed when
// a value exists so a missing token falls back to the CLI's own login.
// ============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  classifyReportFrom,
  probeDomainDns,
} from './verify-resend.mjs';

const DEFAULT_REPO = 'LCHEROURI/portfolio-app-freebuff';
const ENV_LOCAL = new URL('../.env.local', import.meta.url);

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : '';
};

const FROM = flagValue('--from');
const DRY_RUN = args.includes('--dry-run');
const SKIP_DNS = args.includes('--skip-dns');
const REPO = flagValue('--repo') || DEFAULT_REPO;

// ── Helpers ─────────────────────────────────────────────────────────────────

const readEnv = (name) => {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(ENV_LOCAL, 'utf8');
    const m = env.match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^"|"$/g, '') : '';
  } catch {
    return '';
  }
};

/**
 * Pure .env upsert: replace an existing KEY= line or append one at the end.
 * Uses a function replacement so a value containing '$' (e.g. "$1") can never
 * be mangled by String.replace's $-pattern interpolation. Exported so the
 * unit test can assert it without touching the real file.
 */
export const upsertEnv = (contents, key, value) => {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(contents)) return contents.replace(re, () => line);
  const base = contents.replace(/\n*$/, '');
  return base ? `${base}\n${line}\n` : `${line}\n`;
};

/**
 * Run a command. Returns { ok, error, missing }:
 *   ok      — exited 0
 *   missing — the binary is not installed (spawn ENOENT): caller prints the
 *             manual command and continues (skip-not-fail)
 *   error   — the command RAN but failed (non-zero status): caller exits 1
 */
const run = (cmd, cmdArgs, input) => {
  const r = spawnSync(cmd, cmdArgs, { input, encoding: 'utf8' });
  if (r.error) {
    return { ok: false, missing: r.error.code === 'ENOENT', error: r.error.message };
  }
  if (r.status !== 0) {
    return { ok: false, missing: false, error: (r.stderr || r.stdout || '').trim().split('\n')[0] };
  }
  return { ok: true };
};

/** vercel CLI base args; --token only when a value exists. */
const vercelCmd = () => {
  const token = readEnv('VERCEL_TOKEN');
  return token ? ['vercel', '--token', token] : ['vercel'];
};

// ── Main ────────────────────────────────────────────────────────────────────

const main = async () => {
  const from = FROM || readEnv('REPORT_FROM');
  if (!from) {
    console.error('✗ FAIL: pass --from "Name <email@yourdomain.com>" (REPORT_FROM value)');
    process.exit(2);
  }

  const sender = classifyReportFrom(from);
  if (sender.kind === 'sandbox' || sender.kind === 'unset') {
    console.error(`✗ FAIL: '${from}' is the Resend sandbox sender (@resend.dev) — the gate`);
    console.error('  exists to get OFF it. Verify a real domain in Resend first.');
    process.exit(2);
  }
  if (sender.kind === 'malformed') {
    console.error(`✗ FAIL: could not parse a sender email from '${from}'`);
    console.error('  use "Name <email@yourdomain.com>" format.');
    process.exit(2);
  }

  console.log(`\nReport sender: ${from}`);
  console.log(`  domain      ${sender.domain}`);
  console.log(`  target      .env.local → Vercel production → GitHub secret (${REPO})`);
  if (DRY_RUN) console.log('  mode        DRY RUN — nothing will be written');

  // ── DNS preflight (same probe verify:resend uses) ─────────────────────────
  if (!SKIP_DNS) {
    console.log(`\nPreflight: probing ${sender.domain} DNS for Resend TXT records…`);
    const probe = await probeDomainDns(sender.domain);
    if (probe.error) {
      console.error(`✗ FAIL: could not probe ${sender.domain} DNS (${probe.error}) —`);
      console.error('  the domain may not exist or the resolver is unreachable.');
      process.exit(1);
    }
    if (!probe.spf || !probe.dkim) {
      console.error(`✗ FAIL: ${sender.domain} is NOT verified for Resend sending yet:`);
      console.error(`  SPF  ${probe.spf ? '✓ found' : '✗ missing — TXT @ v=spf1 include:amazonses.com ~all'}`);
      console.error(`  DKIM ${probe.dkim ? '✓ found' : '✗ missing — TXT resend._domainkey v=DKIM1; k=rsa; p=…'}`);
      console.error('  Add the records at your DNS provider, click Verify in the Resend');
      console.error('  dashboard, wait for Verified, then re-run this command.');
      process.exit(2);
    }
    console.log(`  SPF ✓ · DKIM ✓ · DMARC ${probe.dmarc ? '✓' : 'optional (missing)'} — domain verified`);
  } else {
    console.log('\nPreflight: --skip-dns given — only use this for DNS propagation lag;');
    console.log('  the verify:resend gate still re-probes the domain on every push.');
  }

  // ── 1. .env.local ─────────────────────────────────────────────────────────
  let envLocal;
  try {
    envLocal = readFileSync(ENV_LOCAL, 'utf8');
  } catch {
    envLocal = '';
  }
  const nextEnv = upsertEnv(envLocal, 'REPORT_FROM', from);
  console.log('\n[1/3] .env.local');
  if (DRY_RUN) {
    console.log(`  would replace REPORT_FROM=… with REPORT_FROM=${from}`);
  } else {
    writeFileSync(ENV_LOCAL, nextEnv);
    console.log('  ✓ REPORT_FROM written');
  }

  // ── 2. Vercel production env ───────────────────────────────────────────────
  console.log('\n[2/3] Vercel production env');
  if (DRY_RUN) {
    console.log('  would run: vercel env rm REPORT_FROM production -y;');
    console.log('             vercel env add REPORT_FROM production (stdin)');
  } else {
    const base = vercelCmd();
    const rm = run(base[0], [...base.slice(1), 'env', 'rm', 'REPORT_FROM', 'production', '-y'], from);
    const add = run(base[0], [...base.slice(1), 'env', 'add', 'REPORT_FROM', 'production', '--yes'], from);
    if (add.ok) {
      console.log('  ✓ REPORT_FROM set on production');
    } else if (add.missing) {
      console.error(`  ✗ vercel CLI not found — run manually:`);
      console.error(`    printf '%s' "${from}" | vercel env add REPORT_FROM production`);
    } else {
      console.error(`  ✗ vercel env add failed: ${add.error}`);
      console.error(`    run manually: printf '%s' "${from}" | vercel env add REPORT_FROM production`);
      process.exit(1);
    }
    if (!rm.ok && !/not found|not exist|ENOENT/i.test(rm.error || '')) {
      console.error(`  note: vercel env rm said: ${rm.error}`);
    }
  }

  // ── 3. GitHub Actions secret ───────────────────────────────────────────────
  console.log(`\n[3/3] GitHub Actions secret (${REPO})`);
  if (DRY_RUN) {
    console.log(`  would run: printf '%s' "${from}" | gh secret set REPORT_FROM --repo ${REPO}`);
  } else {
    const set = run('gh', ['secret', 'set', 'REPORT_FROM', '--repo', REPO], from);
    if (set.ok) {
      console.log(`  ✓ REPORT_FROM set on ${REPO}`);
    } else if (set.missing) {
      console.error(`  ✗ gh CLI not found — run manually:`);
      console.error(`    printf '%s' "${from}" | gh secret set REPORT_FROM --repo ${REPO}`);
    } else {
      console.error(`  ✗ gh secret set failed: ${set.error}`);
      console.error(`    run manually: printf '%s' "${from}" | gh secret set REPORT_FROM --repo ${REPO}`);
      process.exit(1);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log('\nDRY RUN — nothing was written. Re-run without --dry-run to apply.');
    process.exit(0);
  }
  console.log('\nDone. To flip the gate green:');
  console.log('  1. Redeploy production so the cron reads the new sender:  vercel --prod');
  console.log('     (or push to main — Vercel auto-deploys and the pre-push hook verifies)');
  console.log('  2. Verify the gate:  npm run verify:resend');
  console.log('  3. Send a real daily report:  curl -H "Authorization: Bearer $CRON_SECRET" \\');
  console.log('     "https://portfolio-app-freebuff.vercel.app/api/cron/reports?kind=daily"');
  process.exit(0);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
