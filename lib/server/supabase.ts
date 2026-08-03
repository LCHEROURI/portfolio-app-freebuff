// ============================================================================
// Server-only Supabase client (PostgREST over fetch — no SDK dependency).
// All access goes through the service-role key, so RLS is bypassed; every
// query and mutation is therefore scoped to `owner_id` in code below.
// ============================================================================

const url = () => process.env.SUPABASE_URL ?? '';
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const isSupabaseConfigured = (): boolean => Boolean(url() && key());

const headers = (extra?: Record<string, string>): Record<string, string> => ({
  apikey: key(),
  Authorization: `Bearer ${key()}`,
  'Content-Type': 'application/json',
  ...extra,
});

const rest = (table: string, query = '') =>
  `${url()}/rest/v1/${table}${query ? `?${query}` : ''}`;

const throwHttp = async (res: Response, action: string) => {
  const body = await res.text().catch(() => '');
  throw new Error(`Supabase ${action} failed (${res.status}): ${body.slice(0, 300)}`);
};

/** SELECT rows where owner_id matches. */
export const supabaseSelect = async <T>(
  table: string,
  ownerId: string,
  opts: { order?: string } = {},
): Promise<T[]> => {
  const q = new URLSearchParams({ select: '*', owner_id: `eq.${ownerId}` });
  if (opts.order) q.set('order', opts.order);
  const res = await fetch(rest(table, q.toString()), { headers: headers(), cache: 'no-store' });
  if (!res.ok) await throwHttp(res, 'select');
  return res.json() as Promise<T[]>;
};

/** INSERT … ON CONFLICT (id) DO UPDATE — the app's save semantics. */
export const supabaseUpsert = async <T>(
  table: string,
  row: Record<string, unknown>,
): Promise<T> => {
  const res = await fetch(rest(table, 'on_conflict=id'), {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(row),
    cache: 'no-store',
  });
  if (!res.ok) await throwHttp(res, 'upsert');
  const rows = (await res.json()) as T[];
  return rows[0];
};

/** PATCH a single row owned by ownerId. */
export const supabaseUpdate = async <T>(
  table: string,
  id: string,
  ownerId: string,
  patch: Record<string, unknown>,
): Promise<T | null> => {
  const q = new URLSearchParams({
    id: `eq.${id}`,
    owner_id: `eq.${ownerId}`,
    select: '*',
  });
  const res = await fetch(rest(table, q.toString()), {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(patch),
    cache: 'no-store',
  });
  if (!res.ok) await throwHttp(res, 'update');
  const rows = (await res.json()) as T[];
  return rows[0] ?? null;
};

/** DELETE a single row owned by ownerId. */
export const supabaseDelete = async (
  table: string,
  id: string,
  ownerId: string,
): Promise<void> => {
  const q = new URLSearchParams({ id: `eq.${id}`, owner_id: `eq.${ownerId}` });
  const res = await fetch(rest(table, q.toString()), {
    method: 'DELETE',
    headers: headers(),
    cache: 'no-store',
  });
  if (!res.ok && res.status !== 204) await throwHttp(res, 'delete');
};
