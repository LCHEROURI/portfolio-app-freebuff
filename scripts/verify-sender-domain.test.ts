import { describe, expect, it } from 'vitest';
import { assertSendResponse } from './verify-sender-domain.mjs';
import { classifyReportFrom } from './verify-resend.mjs';

// ── assertSendResponse (the real-send verdict) ──────────────────────────────
describe('assertSendResponse', () => {
  it('accepts a sent:true response carrying an emailId', () => {
    expect(assertSendResponse({ ok: true, sent: true, emailId: 'abc-123' })).toEqual({
      ok: true,
      emailId: 'abc-123',
    });
  });

  it('rejects a non-object body', () => {
    expect(assertSendResponse(null).ok).toBe(false);
    expect(assertSendResponse(undefined).ok).toBe(false);
    expect(assertSendResponse('html error page').ok).toBe(false);
  });

  it('rejects sent:true without an emailId', () => {
    const verdict = assertSendResponse({ ok: true, sent: true });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('emailId');
  });

  it('surfaces the server reason when the send was not accepted', () => {
    const verdict = assertSendResponse({ ok: true, sent: false, reason: 'domain not verified' });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('domain not verified');
  });

  it('falls back to message / sent-emailId fields when reason is missing', () => {
    expect(assertSendResponse({ message: 'boom' }).reason).toContain('boom');
    expect(assertSendResponse({ sent: false, emailId: undefined }).reason).toContain('sent=false');
  });
});

// ── sender guard: the confirmation must reject sandbox senders ──────────────
describe('verify-sender-domain sender guard', () => {
  it('classifies the sandbox sender as sandbox (rejected by the gate)', () => {
    expect(classifyReportFrom('Command Center <onboarding@resend.dev>').kind).toBe('sandbox');
  });

  it('classifies a custom verified-domain sender as custom (accepted)', () => {
    expect(classifyReportFrom('Command Center <reports@yourname.com>')).toEqual({
      kind: 'custom',
      email: 'reports@yourname.com',
      domain: 'yourname.com',
    });
  });

  it('classifies an empty value as unset (rejected by the gate)', () => {
    expect(classifyReportFrom('').kind).toBe('unset');
  });
});
