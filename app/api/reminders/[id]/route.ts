import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUserId } from '@/lib/server/user';
import {
  isSupabaseConfigured, supabaseUpdate, supabaseDelete,
} from '@/lib/server/supabase';
import { fromReminderRow, type Row } from '@/lib/server/rows';

const notConfigured = () =>
  NextResponse.json({ ok: false, configured: false, error: 'Supabase is not configured.' }, { status: 200 });

const unauthorized = () =>
  NextResponse.json({ ok: false, error: 'Missing x-app-user header.' }, { status: 401 });

const PATCH_FIELDS: Record<string, { col: string; validate?: (v: unknown) => boolean }> = {
  title: { col: 'title', validate: (v) => typeof v === 'string' && v.trim().length > 0 },
  note: { col: 'note' },
  remindAt: { col: 'remind_at' },
  done: { col: 'done', validate: (v) => typeof v === 'boolean' },
  projectId: { col: 'project_id' },
};

// ─── PATCH /api/reminders/[id] ───────────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = getRequestUserId(req);
  if (!userId) return unauthorized();
  if (!isSupabaseConfigured()) return notConfigured();
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(body)) {
      const field = PATCH_FIELDS[k];
      if (!field) continue;
      if (field.validate && !field.validate(v)) {
        return NextResponse.json({ ok: false, error: `Invalid value for field "${k}".` }, { status: 400 });
      }
      patch[field.col] = v ?? null;
    }
    const saved = await supabaseUpdate<Row>('reminders', params.id, userId, patch);
    if (!saved) {
      return NextResponse.json({ ok: false, error: 'Reminder not found.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, reminder: fromReminderRow(saved) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to update reminder.' },
      { status: 500 },
    );
  }
}

// ─── DELETE /api/reminders/[id] ──────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const userId = getRequestUserId(_req);
  if (!userId) return unauthorized();
  if (!isSupabaseConfigured()) return notConfigured();
  try {
    await supabaseDelete('reminders', params.id, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to delete reminder.' },
      { status: 500 },
    );
  }
}
