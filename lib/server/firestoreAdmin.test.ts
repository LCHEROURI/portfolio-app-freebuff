import { beforeEach, describe, expect, it, vi } from 'vitest';

// The service-account credential layer is mocked so the REST body the test
// inspects never needs a real token or network call.
vi.mock('./sa-token.mjs', () => ({
  isServiceAccountConfigured: vi.fn(() => true),
  mintServiceAccountToken: vi.fn(async () => 'test-token'),
}));

import { isServiceAccountConfigured } from './sa-token.mjs';
import { firestoreList } from './firestoreAdmin';

const fetchMock = vi.fn();

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'test-proj';
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify([
      { document: { name: 'projects/p-1', fields: { name: { stringValue: 'Takeout Voice' } } } },
    ]), { status: 200 }),
  );
});

const bodyOf = (callIdx = 0): { structuredQuery: Record<string, unknown> } =>
  JSON.parse((fetchMock.mock.calls[callIdx][1] as { body: string }).body);

describe('firestoreList — optional read cap (read-budget guard)', () => {
  it('forwards an explicit limit into the runQuery body', async () => {
    await firestoreList('projects', 'u1', 25);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf().structuredQuery.limit).toBe(25);
  });

  it('omits the limit when not provided (cron full-snapshot collections stay unbounded)', async () => {
    await firestoreList('projects', 'u1');
    expect(bodyOf().structuredQuery).not.toHaveProperty('limit');
  });

  it('decodes rows into typed entities with the doc id from the name', async () => {
    const rows = await firestoreList('projects', 'u1');
    expect(rows).toEqual([{ id: 'p-1', name: 'Takeout Voice' }]);
  });

  it('returns [] without a network call when the service account is unconfigured', async () => {
    vi.mocked(isServiceAccountConfigured).mockReturnValue(false);
    const rows = await firestoreList('projects', 'u1', 25);
    expect(rows).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
