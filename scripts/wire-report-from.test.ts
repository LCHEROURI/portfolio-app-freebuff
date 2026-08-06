import { describe, expect, it } from 'vitest';
import { upsertEnv } from './wire-report-from.mjs';
import { classifyReportFrom } from './verify-resend.mjs';

// ── upsertEnv (pure .env upsert) ────────────────────────────────────────────
describe('upsertEnv', () => {
  it('replaces an existing KEY= line in place', () => {
    const contents = [
      'CRON_SECRET=abc',
      'REPORT_EMAIL=you@example.com',
      'REPORT_FROM=Command Center <onboarding@resend.dev>',
      'RESEND_API_KEY=re_old',
    ].join('\n');
    const next = upsertEnv(contents, 'REPORT_FROM', 'Command Center <reports@yourname.com>');
    expect(next).toContain('REPORT_FROM=Command Center <reports@yourname.com>');
    expect(next).not.toContain('onboarding@resend.dev');
    // Sibling lines survive untouched.
    expect(next).toContain('CRON_SECRET=abc');
    expect(next).toContain('RESEND_API_KEY=re_old');
    expect(next.split('\n').filter((l) => l.startsWith('REPORT_FROM='))).toHaveLength(1);
  });

  it('appends the line when the key is absent', () => {
    const contents = ['CRON_SECRET=abc', 'REPORT_EMAIL=you@example.com'].join('\n');
    const next = upsertEnv(contents, 'REPORT_FROM', 'Command Center <reports@yourname.com>');
    expect(next).toContain('REPORT_FROM=Command Center <reports@yourname.com>');
    expect(next).toContain('CRON_SECRET=abc');
  });

  it('handles an empty file', () => {
    const next = upsertEnv('', 'REPORT_FROM', 'Command Center <reports@yourname.com>');
    expect(next).toBe('REPORT_FROM=Command Center <reports@yourname.com>\n');
  });

  it('handles a value with special characters (spaces, angle brackets)', () => {
    const next = upsertEnv('A=1', 'REPORT_FROM', 'Command Center <reports@yourname.com>');
    expect(next).toContain('REPORT_FROM=Command Center <reports@yourname.com>');
  });

  it('never mangles a value containing $ (String.replace interpolation guard)', () => {
    // A literal '$1' in the value must survive byte-for-byte — String.replace
    // with a string replacement would treat '$1' as a capture-group reference.
    const contents = 'REPORT_FROM=Command Center <onboarding@resend.dev>\nRESEND_API_KEY=re_old';
    const next = upsertEnv(contents, 'REPORT_FROM', 'Team $1 <reports@yourname.com>');
    expect(next).toContain('REPORT_FROM=Team $1 <reports@yourname.com>');
    expect(next).toContain('RESEND_API_KEY=re_old');
    expect(next.split('\n').filter((l) => l.startsWith('REPORT_FROM='))).toHaveLength(1);
  });
});

// ── sender guard: the helper must reject sandbox/unset senders ──────────────
describe('wire-report-from sender guard', () => {
  it('classifies the sandbox sender as sandbox (rejected by the helper)', () => {
    expect(classifyReportFrom('Command Center <onboarding@resend.dev>').kind).toBe('sandbox');
  });

  it('classifies a custom domain as custom (accepted by the helper)', () => {
    expect(classifyReportFrom('Command Center <reports@yourname.com>')).toEqual({
      kind: 'custom',
      email: 'reports@yourname.com',
      domain: 'yourname.com',
    });
  });

  it('classifies an empty value as unset (rejected by the helper)', () => {
    expect(classifyReportFrom('').kind).toBe('unset');
  });
});
