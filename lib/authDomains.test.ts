import { describe, it, expect } from 'vitest';

import { isDomainAuthorized, originHostname } from '../lib/authDomains';

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
