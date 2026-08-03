import { NextResponse, type NextRequest } from 'next/server';

import { isSupabaseConfigured, supabaseDelete, supabaseDeleteWhere } from '@/lib/server/supabase';
import { getRequestUserId } from '@/lib/server/user';

// ============================================================================
// DELETE /api/versions/[id] — removes the version and its evaluations (the
// client locally drops the same rows, so a reload stays consistent).
// ============================================================================

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 503 });
  }
  const { id } = params;
  await supabaseDeleteWhere('evaluations', userId, { project_version_id: id });
  await supabaseDelete('versions', id, userId);
  return NextResponse.json({ ok: true });
}
