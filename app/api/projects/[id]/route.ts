import { NextResponse, type NextRequest } from 'next/server';

import { isSupabaseConfigured, supabaseDelete, supabaseDeleteWhere } from '@/lib/server/supabase';
import { getRequestUserId } from '@/lib/server/user';

// ============================================================================
// DELETE /api/projects/[id]
// Removes the project and cascades to its dependent rows (tasks, reminders,
// versions, evaluations) — matching the client's local delete behavior so a
// reload never resurrects orphaned rows from Supabase.
// ============================================================================

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 503 });
  }
  const { id } = params;
  for (const table of ['tasks', 'reminders', 'versions', 'evaluations'] as const) {
    await supabaseDeleteWhere(table, userId, { project_id: id });
  }
  await supabaseDelete('projects', id, userId);
  return NextResponse.json({ ok: true });
}
