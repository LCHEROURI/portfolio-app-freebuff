import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { classifyPdfResponse, mintCustomToken } from './verify-deployed-pdf.mjs';

// ============================================================================
// scripts/verify-deployed-pdf.test.ts — lock the deployed-PDF gate contract.
//
// The pure helpers are unit-tested directly; the CLI main's HTTP surface is
// contract-locked by reading the real module from disk (the same approach the
// other gate tests use), so a future edit that weakens the %PDF- assertion or
// drops the owner-session mint fails here.
// ============================================================================

const SCRIPT = readFileSync('scripts/verify-deployed-pdf.mjs', 'utf8');

describe('mintCustomToken', () => {
  it('returns a signed RS256 JWT with the Identity Toolkit audience + uid claim', () => {
    // A real RSA key: createSign rejects placeholder PEMs, and the signature
    // must verify against the public half of the same key.
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const sa = {
      client_email: 'sa@project.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    };
    const token = mintCustomToken(JSON.stringify(sa), 'owner-uid-123');
    const [headerB64, claimsB64, sigB64] = token.split('.');
    expect(token.split('.')).toHaveLength(3);
    expect(sigB64.length).toBeGreaterThan(10);
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    expect(header.alg).toBe('RS256');
    const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString());
    expect(claims.iss).toBe('sa@project.iam.gserviceaccount.com');
    expect(claims.aud).toBe('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
    expect(claims.uid).toBe('owner-uid-123');
  });

  it('throws a clear error on malformed service-account JSON', () => {
    expect(() => mintCustomToken('not-json', 'uid')).toThrow();
  });
});

describe('classifyPdfResponse', () => {
  it('accepts a genuine PDF response (200 + application/pdf + %PDF- + attachment name)', () => {
    expect(classifyPdfResponse({
      status: 200,
      contentType: 'application/pdf',
      disposition: 'attachment; filename="deployed-pdf-proof.pdf"',
      head: '%PDF-',
    })).toEqual({ authed: true, pdf: true, named: true });
  });

  it('flags a 503 (the pre-fix serverless failure) as not authed/pdf', () => {
    const v = classifyPdfResponse({
      status: 503,
      contentType: 'application/json',
      disposition: null,
      head: '{"ok"',
    });
    expect(v.authed).toBe(false);
    expect(v.pdf).toBe(false);
    expect(v.named).toBe(false);
  });

  it('flags a 200 that is not a PDF (stub body, wrong content-type)', () => {
    const v = classifyPdfResponse({
      status: 200,
      contentType: 'application/json',
      disposition: null,
      head: '{"ok"',
    });
    expect(v.authed).toBe(true);
    expect(v.pdf).toBe(false);
  });

  it('requires the %PDF- magic header even with the right content-type', () => {
    const v = classifyPdfResponse({
      status: 200,
      contentType: 'application/pdf',
      disposition: 'attachment; filename="x.pdf"',
      head: '<html',
    });
    expect(v.pdf).toBe(false);
  });
});

describe('scripts/verify-deployed-pdf.mjs · source contract', () => {
  it('mints the owner session via a SA-signed custom token + signInWithCustomToken', () => {
    expect(SCRIPT).toContain('mintCustomToken(saJson, OWNER)');
    expect(SCRIPT).toContain('accounts:signInWithCustomToken');
    expect(SCRIPT).toContain('identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
  });

  it('asserts the real %PDF- body prefix on the authenticated response', () => {
    expect(SCRIPT).toContain("head: buf.subarray(0, 5).toString()");
    expect(SCRIPT).toContain("contentType === 'application/pdf' && head === '%PDF-'");
  });

  it('checks the unauthenticated 401 gate and the attachment filename', () => {
    expect(SCRIPT).toContain('anon.status !== 401');
    expect(SCRIPT).toContain("disposition.includes('attachment; filename=')");
  });

  it('emits the three sub-result markers for the verify:all summary', () => {
    expect(SCRIPT).toContain('VERIFY-SUBRESULT|auth-gate|');
    expect(SCRIPT).toContain('VERIFY-SUBRESULT|pdf-render|');
    expect(SCRIPT).toContain('VERIFY-SUBRESULT|pdf-filename|');
  });
});
