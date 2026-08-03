import { NextResponse, type NextRequest } from 'next/server';

import { isSupabaseConfigured, supabaseDelete } from '@/lib/server/supabase';
import { getRequestUserId } from '@/lib/server/user';

// ============================================================================
// DELETE /api/evaluations/[id] — remove a single model evaluation.
// ============================================================================

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 503 });
  }
  const { id } = params;
  await supabaseDelete('evaluations', id, userId);
  return NextResponse.json({ ok: true });
}
