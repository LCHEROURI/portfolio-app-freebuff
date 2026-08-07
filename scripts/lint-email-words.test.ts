import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { auditSource, main, scanDir, scanRoots } from './lint-email-words.mjs';

// ── auditSource: banned phrase detection ─────────────────────────────────────
describe('auditSource · banned report-email phrasing', () => {
  it('flags cron-email (the renamed gate)', () => {
    expect(auditSource('// gate: verify:cron-email\n')).toEqual([
      { line: 1, phrase: 'cron-email' },
    ]);
  });

  it('flags "emailed reports" and the singular form', () => {
    expect(auditSource('// emailed reports are sent daily\n')).toEqual([
      { line: 1, phrase: 'emailed report(s)' },
    ]);
    expect(auditSource('// the emailed report arrives by email\n')).toEqual([
      { line: 1, phrase: 'emailed report(s)' },
    ]);
  });

  it('flags "email body" and "email bodies"', () => {
    expect(auditSource('// the email body is composed\n')).toEqual([
      { line: 1, phrase: 'email body' },
    ]);
    expect(auditSource('// both email bodies ship\n')).toEqual([
      { line: 1, phrase: 'email body' },
    ]);
  });

  it('flags "email preview"', () => {
    expect(auditSource('// plain-text email preview below\n')).toEqual([
      { line: 1, phrase: 'email preview' },
    ]);
  });

  it('flags the verb forms "emails you/daily/weekly" and "emailed daily/weekly"', () => {
    expect(auditSource('// the cron emails you a report\n')).toEqual([
      { line: 1, phrase: 'emails (you|daily|weekly)' },
    ]);
    expect(auditSource('// emails daily and weekly reports\n')).toEqual([
      { line: 1, phrase: 'emails (you|daily|weekly)' },
    ]);
    expect(auditSource('// emailed daily reports go out\n')).toEqual([
      { line: 1, phrase: 'emailed (daily|weekly)' },
    ]);
  });

  it('reports multiple hits with their line numbers', () => {
    const src = '// cron-email gate\nconst x = 1;\n// email body here\n';
    expect(auditSource(src)).toEqual([
      { line: 1, phrase: 'cron-email' },
      { line: 3, phrase: 'email body' },
    ]);
  });

  it('passes the in-app report wording that replaced the email language', () => {
    const src = `
      // Reports are composed in-app only — nothing is emailed.
      // The composed report body feeds the in-app Reports page.
      // npm run verify:cron-reports
      // The plain-text report preview is served as text/plain.
      // Local scan freshness section in the composed bodies.
    `;
    expect(auditSource(src)).toEqual([]);
  });

  it('passes auth identity email and removed-env-var lock mentions', () => {
    const src = `
      // sign in with email/password
      const email = user.email;
      await sendPasswordResetEmail(auth, email);
      // RESEND_API_KEY and REPORT_EMAIL must resolve to null (removed vars)
      expect(varSourceUrl('REPORT_FROM')).toBeNull();
    `;
    expect(auditSource(src)).toEqual([]);
  });
});

// ── scanRoots: the real working tree must stay clean ─────────────────────────
describe('scanRoots (live repo)', () => {
  it('finds no report-email phrasing across scripts/, lib/, app/, docs/, .github/, .githooks/, README, .env.example', () => {
    const findings = scanRoots();
    expect(findings).toEqual([]);
  });

  it('skips the linter and its own test (they must quote the phrases)', () => {
    // Self-exclusion lock: the linter file legitimately contains the banned
    // phrases (its definition list) and the test plants them as fixtures, so
    // scanning the real scripts/ root must never report either file.
    const findings = scanDir(join(process.cwd(), 'scripts'));
    const self = findings.filter((f) => f.file.includes('lint-email-words'));
    expect(self).toEqual([]);
  });

  it('skips docs/reviews historical records that legitimately describe the removed feature', () => {
    // The live-clean test above only passes BECAUSE the sweep skips
    // docs/reviews/ — the real dated review records still quote the old
    // wording. Lock the skip boundary explicitly: a file under the repo's own
    // docs/reviews/ subtree is never reported even though it carries the
    // banned phrase. Plant one, scan the subtree root via scanDir's relative-
    // path guard, then clean it up.
    const file = join(process.cwd(), 'docs', 'reviews', '__linttest-historical.md');
    writeFileSync(file, 'The emailed reports were disabled; the email body was removed.\n');
    try {
      expect(scanDir(join(process.cwd(), 'docs', 'reviews'))).toEqual([]);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('finds a planted violation under a temp root and reports file + line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-email-words-'));
    try {
      const file = join(dir, 'verify-bad.mjs');
      writeFileSync(file, '// the cron-email gate is gone\nconst x = 1;\n');
      const findings = scanDir(dir);
      expect(findings).toEqual([
        { file: relative(process.cwd(), file), line: 1, phrase: 'cron-email' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sweeps the prose extensions too (yaml, shell, markdown), not just source files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-email-words-ext-'));
    try {
      writeFileSync(join(dir, 'ci.yml'), '      # the email body is composed here\n');
      writeFileSync(join(dir, 'deploy.sh'), '# emailed reports go out at 06:30\n');
      writeFileSync(join(dir, 'note.md'), 'See the email preview below.\n');
      const findings = scanDir(dir);
      expect(findings).toEqual([
        { file: relative(process.cwd(), join(dir, 'ci.yml')), line: 1, phrase: 'email body' },
        { file: relative(process.cwd(), join(dir, 'deploy.sh')), line: 1, phrase: 'emailed report(s)' },
        { file: relative(process.cwd(), join(dir, 'note.md')), line: 1, phrase: 'email preview' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── main: the CLI exit-code contract ─────────────────────────────────────────
describe('main (CLI exit-code contract)', () => {
  it('returns 1 when the scanned roots contain a banned phrase', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-email-words-cli-'));
    try {
      writeFileSync(join(dir, 'verify-bad.mjs'), '// email body still here\n');
      expect(main([dir])).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns 0 when the scanned roots are clean', () => {
    expect(main()).toBe(0);
  });

  it('returns 1 with a clear message when a root is missing (wrong cwd guard)', () => {
    expect(main(['definitely-not-a-real-root'])).toBe(1);
  });
});
