import { NextResponse, type NextRequest } from 'next/server';

import { fromVersionRow, toVersionRow, type Row } from '@/lib/server/rows';
import { isSupabaseConfigured, supabaseSelect, supabaseUpsert } from '@/lib/server/supabase';
import { getRequestUserId } from '@/lib/server/user';
import { ProjectVersionSchema } from '@/types';

// ============================================================================
// /api/versions — Supabase-backed project versions.
//   GET  → list versions for the acting user
//   POST → upsert one version (insert-or-update on id)
// ============================================================================

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, configured: false, versions: [] });
  }
  const rows = await supabaseSelect<Row>('versions', userId, { order: 'created_at' });
  return NextResponse.json({ ok: true, configured: true, versions: rows.map(fromVersionRow) });
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 503 });
  }
  const body = await req.json();
  const parsed = ProjectVersionSchema.safeParse({ ...body, userId });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Payload failed validation', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const saved = await supabaseUpsert<Row>('versions', toVersionRow(parsed.data));
  return NextResponse.json({ ok: true, version: fromVersionRow(saved) });
}
