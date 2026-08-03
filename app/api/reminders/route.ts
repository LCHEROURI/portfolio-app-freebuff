import { NextResponse, type NextRequest } from 'next/server';

import { ReminderSchema, type Reminder } from '@/types';
import type { Row } from '@/lib/server/rows';
import { getRequestUserId } from '@/lib/server/user';
import {
  isSupabaseConfigured, supabaseSelect, supabaseUpsert,
} from '@/lib/server/supabase';
import { toReminderRow, fromReminderRow } from '@/lib/server/rows';

const notConfigured = () =>
  NextResponse.json({ ok: false, configured: false, error: 'Supabase is not configured.' }, { status: 200 });

const unauthorized = () =>
  NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });

// ─── GET /api/reminders ──────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) return unauthorized();
  if (!isSupabaseConfigured()) return notConfigured();
  try {
    const rows = await supabaseSelect<Row>('reminders', userId, { order: 'remind_at.asc' });
    return NextResponse.json({ ok: true, configured: true, reminders: rows.map(fromReminderRow) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, configured: true, error: err instanceof Error ? err.message : 'Failed to load reminders.' },
      { status: 500 },
    );
  }
}

// ─── POST /api/reminders ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) return unauthorized();
  if (!isSupabaseConfigured()) return notConfigured();
  try {
    const body = (await req.json()) as Partial<Reminder>;
    const now = new Date().toISOString();
    const reminder: Reminder = {
      id: body.id ?? `rm-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      userId,
      projectId: body.projectId,
      title: String(body.title ?? '').trim(),
      note: body.note,
      remindAt: body.remindAt ?? now,
      done: Boolean(body.done),
      createdAt: body.createdAt ?? now,
      updatedAt: now,
    };
    const parsed = ReminderSchema.safeParse(reminder);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    const saved = await supabaseUpsert<Row>('reminders', toReminderRow(parsed.data));
    return NextResponse.json({ ok: true, reminder: fromReminderRow(saved) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to save reminder.' },
      { status: 500 },
    );
  }
}
