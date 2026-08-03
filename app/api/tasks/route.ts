import { NextResponse, type NextRequest } from 'next/server';

import { TaskSchema, type Task } from '@/types';
import type { Row } from '@/lib/server/rows';
import { getRequestUserId } from '@/lib/server/user';
import {
  isSupabaseConfigured, supabaseSelect, supabaseUpsert,
} from '@/lib/server/supabase';
import { toTaskRow, fromTaskRow } from '@/lib/server/rows';

const notConfigured = () =>
  NextResponse.json({ ok: false, configured: false, error: 'Supabase is not configured.' }, { status: 200 });

const unauthorized = () =>
  NextResponse.json({ ok: false, error: 'Missing x-app-user header.' }, { status: 401 });

// ─── GET /api/tasks  (list all for the user) ─────────────────────────────────
export async function GET(req: NextRequest) {
  const userId = getRequestUserId(req);
  if (!userId) return unauthorized();
  if (!isSupabaseConfigured()) return notConfigured();
  try {
    const rows = await supabaseSelect<Row>('tasks', userId, { order: 'created_at.asc' });
    return NextResponse.json({ ok: true, configured: true, tasks: rows.map(fromTaskRow) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, configured: true, error: err instanceof Error ? err.message : 'Failed to load tasks.' },
      { status: 500 },
    );
  }
}

// ─── POST /api/tasks  (create or upsert by id) ───────────────────────────────
export async function POST(req: NextRequest) {
  const userId = getRequestUserId(req);
  if (!userId) return unauthorized();
  if (!isSupabaseConfigured()) return notConfigured();
  try {
    const body = (await req.json()) as Partial<Task>;
    const task: Task = {
      id: body.id ?? `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      userId,
      projectId: body.projectId ?? '',
      title: String(body.title ?? '').trim(),
      description: body.description,
      status: body.status ?? 'BACKLOG',
      priority: body.priority ?? 'P2_MEDIUM',
      taskType: body.taskType ?? 'FEATURE',
      dueDate: body.dueDate,
      reminderDate: body.reminderDate,
      completedAt: body.completedAt,
      estimatedMinutes: body.estimatedMinutes,
      actualMinutes: body.actualMinutes,
      blockedBy: body.blockedBy,
      source: body.source,
      position: body.position ?? 0,
      createdAt: body.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const parsed = TaskSchema.safeParse(task);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    const saved = await supabaseUpsert<Row>('tasks', toTaskRow(parsed.data));
    return NextResponse.json({ ok: true, task: fromTaskRow(saved) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to save task.' },
      { status: 500 },
    );
  }
}
