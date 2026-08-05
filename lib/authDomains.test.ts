import { describe, it, expect } from 'vitest';

import { isDomainAuthorized, normalizeProjectOrigin, originHostname } from '../lib/authDomains';

const PROD_LIST = [
  'localhost',
  'meal-planner-lcherouri.firebaseapp.com',
  'meal-planner-lcherouri.web.app',
];

describe('originHostname', () => {
  it('strips scheme and port', () => {
    expect(originHostname('http://localhost:3000')).toBe('localhost');
    expect(originHostname('https://portfolio-app-freebuff.vercel.app')).toBe(
      'portfolio-app-freebuff.vercel.app',
    );
  });

  it('tolerates a trailing dot', () => {
    expect(originHostname('https://example.com.')).toBe('example.com');
  });
});

describe('isDomainAuthorized', () => {
  it('matches a listed hostname exactly (case-insensitive)', () => {
    expect(isDomainAuthorized(PROD_LIST, 'http://localhost:3000')).toBe(true);
    expect(isDomainAuthorized(PROD_LIST, 'https://meal-planner-lcherouri.firebaseapp.com')).toBe(true);
  });

  it('flags an origin missing from the list', () => {
    expect(isDomainAuthorized(PROD_LIST, 'https://portfolio-app-freebuff.vercel.app')).toBe(false);
  });

  it('handles an empty list', () => {
    expect(isDomainAuthorized([], 'https://anything.example')).toBe(false);
  });
});

describe('normalizeProjectOrigin', () => {
  it('accepts a bare hostname, assuming https', () => {
    expect(normalizeProjectOrigin('portfolio-app-freebuff.vercel.app')).toBe(
      'https://portfolio-app-freebuff.vercel.app',
    );
  });

  it('accepts a full URL and strips path/query', () => {
    expect(normalizeProjectOrigin('https://preview-abc.vercel.app/foo?x=1')).toBe(
      'https://preview-abc.vercel.app',
    );
  });

  it('preserves a non-default port', () => {
    expect(normalizeProjectOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('allows localhost', () => {
    expect(normalizeProjectOrigin('localhost')).toBe('https://localhost');
  });

  it('rejects garbage, single-label hostnames, and empties', () => {
    expect(normalizeProjectOrigin('not a url')).toBeNull();
    expect(normalizeProjectOrigin('foo')).toBeNull();
    expect(normalizeProjectOrigin('')).toBeNull();
    expect(normalizeProjectOrigin('   ')).toBeNull();
  });
});
