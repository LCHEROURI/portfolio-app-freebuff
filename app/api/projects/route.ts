import { NextResponse, type NextRequest } from 'next/server';

import { fromProjectRow, toProjectRow, type Row } from '@/lib/server/rows';
import { isSupabaseConfigured, supabaseSelect, supabaseUpsert } from '@/lib/server/supabase';
import { getRequestUserId } from '@/lib/server/user';
import { ProjectSchema } from '@/types';

// ============================================================================
// /api/projects — Supabase-backed projects (the automation engine reads the
// same table so project-level rules evaluate real data).
//   GET  → list projects for the acting user
//   POST → upsert one project (insert-or-update on id, full-document save)
// ============================================================================

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, configured: false, projects: [] });
  }
  const rows = await supabaseSelect<Row>('projects', userId, { order: 'updated_at.desc' });
  return NextResponse.json({ ok: true, configured: true, projects: rows.map(fromProjectRow) });
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 503 });
  }
  const body = await req.json();
  const parsed = ProjectSchema.safeParse({ ...body, userId });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Payload failed validation', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const saved = await supabaseUpsert<Row>('projects', toProjectRow(parsed.data));
  return NextResponse.json({ ok: true, project: fromProjectRow(saved) });
}
