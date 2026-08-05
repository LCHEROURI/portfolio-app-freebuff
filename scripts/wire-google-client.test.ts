import { describe, expect, it } from 'vitest';
import {
  isClassicClientSecret,
  isClassicWebClientId,
} from './wire-google-client.mjs';

describe('isClassicWebClientId', () => {
  it('accepts a real classic web client id', () => {
    expect(isClassicWebClientId('952213217375-abc123def456.apps.googleusercontent.com')).toBe(true);
  });

  it('rejects Workforce-style UUID ids created by gcloud iam oauth-clients', () => {
    // The exact id the earlier (wrong) gcloud-created client had.
    expect(isClassicWebClientId('af28e1eb0-e4d3-4c68-9ef0-3a8a2c5f696f')).toBe(false);
  });

  it('rejects bare project numbers and missing suffixes', () => {
    expect(isClassicWebClientId('952213217375')).toBe(false);
    expect(isClassicWebClientId('952213217375-abc.example.com')).toBe(false);
    expect(isClassicWebClientId('abc.apps.googleusercontent.com')).toBe(false);
  });

  it('rejects the template placeholder', () => {
    expect(isClassicWebClientId('952213217375-xxxx.apps.googleusercontent.com')).toBe(false);
    expect(isClassicWebClientId('')).toBe(false);
    expect(isClassicWebClientId(undefined as unknown as string)).toBe(false);
    expect(isClassicWebClientId(123 as unknown as string)).toBe(false);
  });

  it('accepts hyphenated hashes and multi-digit project numbers', () => {
    expect(isClassicWebClientId('1234567890123-foo-bar_baz.apps.googleusercontent.com')).toBe(true);
  });
});

describe('isClassicClientSecret', () => {
  it('accepts a real GOCSPX secret', () => {
    expect(isClassicClientSecret('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8e43e791c601eee05e6253465c7b2e476973')).toBe(true);
  });

  it('rejects the template placeholder and short values', () => {
    expect(isClassicClientSecret('GOCSPX-xxxx')).toBe(false);
    expect(isClassicClientSecret('GOCSPX-x')).toBe(false);
  });

  it('rejects non-GOCSPX values', () => {
    expect(isClassicClientSecret('AIzaSyA9iUv7FVUDEuwO5pdEd8RXJc9qshNMRlE')).toBe(false);
    expect(isClassicClientSecret('')).toBe(false);
    expect(isClassicClientSecret(undefined as unknown as string)).toBe(false);
  });

  it('accepts lowercase/underscore/dash characters after the prefix (16+ chars)', () => {
    expect(isClassicClientSecret('GOCSPX-abc_DEf-1234567890')).toBe(true);
    expect(isClassicClientSecret('GOCSPX-a'.padEnd(7 + 16, 'x'))).toBe(true);
  });
});
