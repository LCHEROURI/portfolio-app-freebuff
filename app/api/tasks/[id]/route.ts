import { NextResponse, type NextRequest } from 'next/server';

import {
  type Task, TASK_STATUSES, PRIORITY_LEVELS, TASK_TYPES,
} from '@/types';
import { getRequestUserId } from '@/lib/server/user';
import {
  isSupabaseConfigured, supabaseUpdate, supabaseDelete,
} from '@/lib/server/supabase';
import { fromTaskRow, type Row } from '@/lib/server/rows';

const notConfigured = () =>
  NextResponse.json({ ok: false, configured: false, error: 'Supabase is not configured.' }, { status: 200 });

const unauthorized = () =>
  NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });

/** Validated column whitelist: camelCase API key → snake_case column + optional value check. */
const PATCH_FIELDS: Record<string, { col: string; validate?: (v: unknown) => boolean }> = {
  title: { col: 'title', validate: (v) => typeof v === 'string' && v.trim().length > 0 },
  description: { col: 'description' },
  status: { col: 'status', validate: (v) => TASK_STATUSES.includes(v as Task['status']) },
  priority: { col: 'priority', validate: (v) => PRIORITY_LEVELS.includes(v as Task['priority']) },
  taskType: { col: 'task_type', validate: (v) => TASK_TYPES.includes(v as Task['taskType']) },
  dueDate: { col: 'due_date' },
  reminderDate: { col: 'reminder_date' },
  completedAt: { col: 'completed_at' },
  estimatedMinutes: { col: 'estimated_minutes' },
  actualMinutes: { col: 'actual_minutes' },
  blockedBy: { col: 'blocked_by' },
  source: { col: 'source' },
  position: { col: 'position' },
  projectId: { col: 'project_id' },
  projectVersionId: { col: 'project_version_id' },
};

// ─── PATCH /api/tasks/[id] ───────────────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getRequestUserId(req);
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
    const saved = await supabaseUpdate<Row>('tasks', params.id, userId, patch);
    if (!saved) {
      return NextResponse.json({ ok: false, error: 'Task not found.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, task: fromTaskRow(saved) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to update task.' },
      { status: 500 },
    );
  }
}

// ─── DELETE /api/tasks/[id] ──────────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getRequestUserId(_req);
  if (!userId) return unauthorized();
  if (!isSupabaseConfigured()) return notConfigured();
  try {
    await supabaseDelete('tasks', params.id, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to delete task.' },
      { status: 500 },
    );
  }
}
