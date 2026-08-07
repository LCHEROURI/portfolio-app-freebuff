import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  auditSource,
  envIdentifierPhrases,
  extractRemovedEnvVars,
  main,
  removedVarsArraySpan,
  scanDir,
  scanRoots,
} from './lint-dead-words.mjs';

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

  it('passes auth identity email identifiers (not report phrasing)', () => {
    const src = `
      // sign in with email/password
      const email = user.email;
      await sendPasswordResetEmail(auth, email);
    `;
    expect(auditSource(src)).toEqual([]);
  });
});

// ── auditSource: banned dead-integration phrasing ───────────────────────────
describe('auditSource · banned dead-integration phrasing', () => {
  it('flags the removed data store name and its env identifiers', () => {
    expect(auditSource('// the Supabase migration removed it\n')).toEqual([
      { line: 1, phrase: 'supabase' },
    ]);
    // The env identifier contains the generic name, so BOTH phrases report.
    expect(auditSource('SUPABASE_URL=postgres://…\n')).toEqual([
      { line: 1, phrase: 'supabase' },
      { line: 1, phrase: 'SUPABASE_URL' },
    ]);
    expect(auditSource('SUPABASE_SERVICE_ROLE_KEY is gone\n')).toEqual([
      { line: 1, phrase: 'supabase' },
      { line: 1, phrase: 'SUPABASE_SERVICE_ROLE_KEY' },
    ]);
  });

  it('flags the removed delivery sender name and its env identifiers', () => {
    expect(auditSource('// the Resend key was revoked\n')).toEqual([
      { line: 1, phrase: 'resend' },
    ]);
    // RESEND_API_KEY contains the generic name, so BOTH phrases report.
    expect(auditSource('RESEND_API_KEY must stay gone\n')).toEqual([
      { line: 1, phrase: 'resend' },
      { line: 1, phrase: 'RESEND_API_KEY' },
    ]);
    expect(auditSource('REPORT_EMAIL is dead\n')).toEqual([
      { line: 1, phrase: 'REPORT_EMAIL' },
    ]);
    expect(auditSource('REPORT_FROM removed\n')).toEqual([
      { line: 1, phrase: 'REPORT_FROM' },
    ]);
  });

  it('exempts only the lock-file helper-call statements that must quote the dead names', () => {
    const src = `
      // SUPABASE_URL must never resolve to a source page
      expect(varSourceUrl('SUPABASE_URL')).toBeNull();
      expect(varEnvLine('RESEND_API_KEY')).toBeNull();
      expect(firstVarSource(['REPORT_EMAIL'])).toBeNull();
    `;
    // The prose comment still flags (both the generic name and the identifier);
    // the three helper-call statements are exempt.
    expect(auditSource(src, 'lib/integrationVarLinks.test.ts')).toEqual([
      { line: 2, phrase: 'supabase' },
      { line: 2, phrase: 'SUPABASE_URL' },
    ]);
  });

  it('still flags a prose comment that mentions a helper name on the same line', () => {
    // The exemption is scoped to helper-call STATEMENTS (trimmed line starts
    // with expect(/return), so a prose comment quoting a helper name next to a
    // dead identifier must NOT sneak through on a helper token.
    const src = `// never call varSourceUrl('SUPABASE_URL') outside the lock\n`;
    expect(auditSource(src, 'lib/integrationVarLinks.test.ts')).toEqual([
      { line: 1, phrase: 'supabase' },
      { line: 1, phrase: 'SUPABASE_URL' },
    ]);
  });

  it('flags the dead names on helper-call lines outside the lock file', () => {
    expect(auditSource("expect(varSourceUrl('SUPABASE_URL')).toBeNull();\n")).toEqual([
      { line: 1, phrase: 'supabase' },
      { line: 1, phrase: 'SUPABASE_URL' },
    ]);
  });
});

// ── Source of truth: REMOVED_ENV_VARS in lib/integrationVarLinks.ts ──────────
describe('env-identifier phrases derived from the source of truth', () => {
  it('extracts every REMOVED_ENV_VARS entry from the live lib/integrationVarLinks.ts', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'integrationVarLinks.ts'), 'utf8');
    const names = extractRemovedEnvVars(src);
    expect(names.length).toBeGreaterThanOrEqual(5);
    expect(names).toContain('SUPABASE_URL');
    expect(names).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(names).toContain('RESEND_API_KEY');
    expect(names).toContain('REPORT_EMAIL');
    expect(names).toContain('REPORT_FROM');
  });

  it('auto-bans a NEW identifier added to the source of truth (drift lock)', () => {
    // The whole point of the derivation: adding an identifier to the
    // REMOVED_ENV_VARS array must immediately extend the sweep, with no
    // separate linter edit. envIdentifierPhrases is the exact builder the
    // module uses to derive BANNED_ENV_PHRASES from the live file, so a new
    // name becomes a live banned phrase on the next module load.
    const phrases = envIdentifierPhrases(['BRAND_NEW_DEAD_VAR']);
    expect(phrases).toEqual([{ phrase: 'BRAND_NEW_DEAD_VAR', re: /BRAND_NEW_DEAD_VAR/i }]);
    expect(phrases[0].re.test('BRAND_NEW_DEAD_VAR must never return')).toBe(true);
  });

  it('every identifier in the live source of truth is a live banned phrase', () => {
    // The real drift lock: auditSource uses the module-level BANNED_PHRASES,
    // which is derived from the live REMOVED_ENV_VARS at load. If the array
    // and the sweep ever drift (a name added to the source but not banned),
    // this test fails — so the two can never diverge.
    const src = readFileSync(join(process.cwd(), 'lib', 'integrationVarLinks.ts'), 'utf8');
    for (const name of extractRemovedEnvVars(src)) {
      expect(auditSource(`# ${name} must never return\n`)).toContainEqual({ line: 1, phrase: name });
    }
  });

  it('fails loudly when REMOVED_ENV_VARS is missing from the truth file', () => {
    expect(() => extractRemovedEnvVars('export const OTHER = 1;\n')).toThrow(
      /REMOVED_ENV_VARS not found/,
    );
  });

  it('fails loudly when REMOVED_ENV_VARS is empty', () => {
    expect(() => extractRemovedEnvVars('export const REMOVED_ENV_VARS = [];\n')).toThrow(
      /REMOVED_ENV_VARS in lib\/integrationVarLinks\.ts is empty/,
    );
  });

  it('computes the array-literal line span for the truth-file exemption', () => {
    const src = 'const a = 1;\nexport const REMOVED_ENV_VARS = [\n  \'A_VAR\',\n  \'B_VAR\',\n];\n';
    expect(removedVarsArraySpan(src)).toEqual([2, 5]);
  });

  it('exempts only the REMOVED_ENV_VARS array lines inside the truth file', () => {
    const src = [
      '// header',
      'export const REMOVED_ENV_VARS = [',
      "  'SUPABASE_URL',",
      "  'RESEND_API_KEY',",
      '];',
      '// SUPABASE_URL outside the array is still banned',
    ].join('\n');
    // Array lines 2-5 are exempt (they must quote the dead names to define
    // them); the trailing comment on line 6 is still flagged.
    expect(auditSource(src, 'lib/integrationVarLinks.ts')).toEqual([
      { line: 6, phrase: 'supabase' },
      { line: 6, phrase: 'SUPABASE_URL' },
    ]);
  });

  it('finds no dead-feature phrasing in the live truth file itself', () => {
    const findings = scanDir(join(process.cwd(), 'lib'));
    const truthHits = findings.filter((f) => f.file.endsWith('integrationVarLinks.ts'));
    expect(truthHits).toEqual([]);
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
    const self = findings.filter((f) => f.file.includes('lint-dead-words'));
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
    const dir = mkdtempSync(join(tmpdir(), 'lint-dead-words-'));
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
    const dir = mkdtempSync(join(tmpdir(), 'lint-dead-words-ext-'));
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
    const dir = mkdtempSync(join(tmpdir(), 'lint-dead-words-cli-'));
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
