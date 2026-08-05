import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';
import { getRequestUserId } from '@/lib/server/user';
import { checkIntegrations } from '@/lib/server/status';

vi.mock('@/lib/server/user', () => ({
  getRequestUserId: vi.fn(async () => 'e2e-user'),
}));

vi.mock('@/lib/server/status', () => ({
  checkIntegrations: vi.fn(async () => []),
}));

describe('GET /api/status — ?project= override', () => {
  beforeEach(() => {
    vi.mocked(checkIntegrations).mockClear();
    vi.mocked(getRequestUserId).mockClear();
  });

  it('forwards a normalized ?project= override to the checks', async () => {
    const req = new NextRequest(
      'http://localhost/api/status?project=portfolio-app-freebuff.vercel.app',
    );
    await GET(req);
    expect(checkIntegrations).toHaveBeenCalledWith(
      false,
      'http://localhost',
      'https://portfolio-app-freebuff.vercel.app',
    );
  });

  it('falls back to the request origin when ?project= is absent or invalid', async () => {
    await GET(new NextRequest('http://localhost/api/status'));
    expect(checkIntegrations).toHaveBeenCalledWith(false, 'http://localhost', undefined);

    await GET(new NextRequest('http://localhost/api/status?project=not a url'));
    expect(checkIntegrations).toHaveBeenLastCalledWith(false, 'http://localhost', undefined);
  });

  it('rejects unauthenticated requests before any check runs', async () => {
    vi.mocked(getRequestUserId).mockResolvedValueOnce(null);
    const res = await GET(new NextRequest('http://localhost/api/status?project=foo.vercel.app'));
    expect(res.status).toBe(401);
    expect(checkIntegrations).not.toHaveBeenCalled();
  });
});
