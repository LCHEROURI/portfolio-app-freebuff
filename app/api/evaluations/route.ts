import { NextResponse, type NextRequest } from 'next/server';

import { fromEvaluationRow, toEvaluationRow, type Row } from '@/lib/server/rows';
import { isSupabaseConfigured, supabaseSelect, supabaseUpsert } from '@/lib/server/supabase';
import { getRequestUserId } from '@/lib/server/user';
import { ModelEvaluationSchema } from '@/types';

// ============================================================================
// /api/evaluations — Supabase-backed model evaluations.
//   GET  → list evaluations for the acting user
//   POST → upsert one evaluation (insert-or-update on id)
// ============================================================================

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, configured: false, evaluations: [] });
  }
  const rows = await supabaseSelect<Row>('evaluations', userId, { order: 'updated_at.desc' });
  return NextResponse.json({ ok: true, configured: true, evaluations: rows.map(fromEvaluationRow) });
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 503 });
  }
  const body = await req.json();
  const parsed = ModelEvaluationSchema.safeParse({ ...body, userId });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Payload failed validation', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const saved = await supabaseUpsert<Row>('evaluations', toEvaluationRow(parsed.data));
  return NextResponse.json({ ok: true, evaluation: fromEvaluationRow(saved) });
}
