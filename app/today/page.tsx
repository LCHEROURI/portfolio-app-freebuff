'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  CalendarClock, AlertCircle, TrendingUp, CheckCircle2, ChevronRight,
  Plus, Bell, Trash2, RotateCcw, RefreshCw,
} from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { PriorityBadge, StatusBadge, Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { TaskModal } from '@/components/tasks/TaskModal';
import { useStore } from '@/lib/store';
import { buildTopThree, isDueToday, isOverdue, timeAgo } from '@/lib/engine';
import type { Task, Reminder } from '@/types';

const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const todayInput = () => {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

const nowInput = () => {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  const h = `${d.getHours()}`.padStart(2, '0');
  const min = `${d.getMinutes()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}T${h}:${min}`;
};

export default function TodayPage() {
  const store = useStore();
  const topThree = buildTopThree(store);
  const dueToday = store.tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELED' && isDueToday(t.dueDate));
  const overdue = store.tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELED' && isOverdue(t.dueDate));
  const recentDone = store.tasks
    .filter((t) => t.status === 'COMPLETED')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, 5);

  const [quickTitle, setQuickTitle] = useState('');
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderAt, setReminderAt] = useState(() => nowInput());
  const [editing, setEditing] = useState<Task | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const projectName = (id: string) => store.projects.find((p) => p.id === id)?.name ?? 'Unknown';
  const fallbackProjectId = store.projects[0]?.id ?? 'p-unsorted';

  // Reminders: prefer the live/dedicated reminder list; fall back to
  // task-derived reminders (tasks with a reminder date set for today).
  const liveReminders = store.reminders
    .filter((r) => !r.done && isDueToday(r.remindAt))
    .sort((a, b) => a.remindAt.localeCompare(b.remindAt));
  const taskDerivedReminders = store.tasks.filter(
    (t) => t.reminderDate && isDueToday(t.reminderDate) && t.status !== 'COMPLETED' && t.status !== 'CANCELED',
  );
  const reminders = store.live.reminders ? liveReminders : taskDerivedReminders.map((t) => ({
    id: `derived-${t.id}`, userId: store.userId, title: t.title, remindAt: t.reminderDate!, done: false,
    projectId: t.projectId, createdAt: t.createdAt, updatedAt: t.updatedAt,
  }) as Reminder);

  const quickAdd = async (e: FormEvent) => {
    e.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    const now = new Date().toISOString();
    const task: Task = {
      id: uid('t'), userId: store.userId, projectId: fallbackProjectId,
      title, status: 'NEXT', priority: 'P2_MEDIUM', taskType: 'FEATURE',
      dueDate: todayInput(), position: store.tasks.length, createdAt: now, updatedAt: now,
    };
    await store.saveTask(task);
    setQuickTitle('');
  };

  const addReminder = async (e: FormEvent) => {
    e.preventDefault();
    const title = reminderTitle.trim();
    if (!title) return;
    const now = new Date().toISOString();
    await store.saveReminder({
      id: uid('rm'), userId: store.userId, projectId: fallbackProjectId,
      title, remindAt: reminderAt || now, done: false, createdAt: now, updatedAt: now,
    });
    setReminderTitle('');
  };

  const liveBadge = () => {
    const parts: string[] = [];
    if (store.live.tasks) parts.push('Tasks live');
    if (store.live.reminders) parts.push('Reminders live');
    if (parts.length === 0) return null;
    return <Badge tone="basil"><RefreshCw size={11} aria-hidden="true" /> {parts.join(' · ')}</Badge>;
  };

  return (
    <div>
      <PageHeader
        title="Today"
        description={`${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} — focus on what moves the needle.`}
        action={liveBadge()}
      />

      {/* Top three hero */}
      <section aria-label="Today's top three" className="mb-6">
        <Card className="bg-gradient-warm dark:bg-pepper-800">
          <CardHeader title="Today's Top Three" subtitle="Auto-computed from the priority queue and your due dates." action={<TrendingUp size={18} className="text-tomato-500" aria-hidden="true" />} />
          {topThree.length === 0 ? (
            <p className="text-sm text-pepper-500 dark:text-pepper-300">Nothing urgent. Use the time for comparisons, roadmap, or rest. 🎉</p>
          ) : (
            <ol className="space-y-3">
              {topThree.map((action, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold text-white ${i === 0 ? 'bg-paprika-500' : i === 1 ? 'bg-tomato-500' : 'bg-turmeric-500'}`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-pepper-900 dark:text-flour-50">{action.title}</p>
                    <p className="text-sm text-pepper-500 dark:text-pepper-300">{action.description}</p>
                  </div>
                  {action.taskId && (
                    <button
                      type="button"
                      className="btn-ghost shrink-0 rounded-md p-1.5 text-basil-600 dark:text-basil-400"
                      aria-label={`Complete ${action.title}`}
                      title="Mark done"
                      onClick={() => store.completeTask(action.taskId!)}
                    >
                      <CheckCircle2 size={17} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Due today */}
        <section aria-label="Due today">
          <Card>
            <CardHeader title="Due today" subtitle={`${dueToday.length} task${dueToday.length === 1 ? '' : 's'}`} action={<CalendarClock size={18} className="text-turmeric-500" aria-hidden="true" />} />
            <form onSubmit={quickAdd} className="mb-3 flex gap-2">
              <input
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder="Quick-add a task due today…"
                className="input-base"
                aria-label="Quick-add task due today"
              />
              <button type="submit" className="btn-primary shrink-0 px-3" aria-label="Add task">
                <Plus size={16} aria-hidden="true" />
              </button>
            </form>
            {dueToday.length === 0 ? (
              <p className="text-sm text-pepper-500 dark:text-pepper-300">Nothing due today.</p>
            ) : (
              <ul className="space-y-2">
                {dueToday.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 rounded-xl2 border border-butter-200 p-3 dark:border-pepper-700">
                    <button type="button" className="text-basil-500 hover:text-basil-700" aria-label={`Complete ${t.title}`} onClick={() => store.completeTask(t.id)}>
                      <CheckCircle2 size={18} aria-hidden="true" />
                    </button>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setEditing(t); setEditModalOpen(true); }}>
                      <p className="truncate font-medium">{t.title}</p>
                      <p className="text-xs text-pepper-400">{projectName(t.projectId)}</p>
                    </button>
                    <PriorityBadge priority={t.priority} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        {/* Overdue */}
        <section aria-label="Overdue tasks">
          <Card>
            <CardHeader title="Overdue" subtitle={`${overdue.length} past due`} action={<AlertCircle size={18} className="text-paprika-500" aria-hidden="true" />} />
            {overdue.length === 0 ? (
              <p className="text-sm text-pepper-500 dark:text-pepper-300">Nothing overdue. 🎉</p>
            ) : (
              <ul className="space-y-2">
                {overdue.map((t) => (
                  <li key={t.id} className="rounded-xl2 border border-paprika-200 bg-paprika-50 p-3 dark:border-paprika-800 dark:bg-paprika-950/40">
                    <div className="flex items-center gap-2">
                      <button type="button" className="shrink-0 text-basil-600 hover:text-basil-700 dark:text-basil-400" aria-label={`Complete ${t.title}`} onClick={() => store.completeTask(t.id)}>
                        <CheckCircle2 size={17} aria-hidden="true" />
                      </button>
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setEditing(t); setEditModalOpen(true); }}>
                        <p className="truncate font-medium text-paprika-700 dark:text-paprika-200">{t.title}</p>
                        <p className="text-xs text-paprika-500 dark:text-paprika-300">{projectName(t.projectId)} · due {new Date(t.dueDate!).toLocaleDateString()}</p>
                      </button>
                      <StatusBadge status={t.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        {/* Reminders */}
        <section aria-label="Reminders">
          <Card>
            <CardHeader
              title="Reminders"
              subtitle={store.live.reminders ? 'Synced to Supabase.' : 'Tasks with a reminder set for today.'}
              action={<Bell size={18} className="text-turmeric-500" aria-hidden="true" />}
            />
            {store.live.reminders && (
              <form onSubmit={addReminder} className="mb-3 flex gap-2">
                <input
                  type="text"
                  value={reminderTitle}
                  onChange={(e) => setReminderTitle(e.target.value)}
                  placeholder="New reminder…"
                  className="input-base"
                  aria-label="New reminder title"
                />
                <input
                  type="datetime-local"
                  value={reminderAt}
                  onChange={(e) => setReminderAt(e.target.value)}
                  className="input-base w-44 shrink-0"
                  aria-label="Reminder time"
                />
                <button type="submit" className="btn-primary shrink-0 px-3" aria-label="Add reminder">
                  <Plus size={16} aria-hidden="true" />
                </button>
              </form>
            )}
            {reminders.length === 0 ? (
              <p className="text-sm text-pepper-500 dark:text-pepper-300">No reminders for today.</p>
            ) : (
              <ul className="space-y-2">
                {reminders.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl2 border border-butter-200 p-2.5 text-sm dark:border-pepper-700">
                    <div className="flex min-w-0 items-center gap-2">
                      {store.live.reminders && (
                        <button
                          type="button"
                          className="shrink-0 text-basil-500 hover:text-basil-700"
                          aria-label={`Mark ${r.title} done`}
                          onClick={() => store.toggleReminder(r.id)}
                        >
                          <CheckCircle2 size={16} aria-hidden="true" />
                        </button>
                      )}
                      <span className="truncate font-medium">{r.title}</span>
                      <span className="shrink-0 text-xs text-pepper-400">{new Date(r.remindAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {store.live.reminders && r.projectId && (
                        <Link href={`/projects/${r.projectId}`} className="text-pepper-400 hover:text-tomato-600">
                          <ChevronRight size={15} aria-hidden="true" />
                        </Link>
                      )}
                      {store.live.reminders && (
                        <button
                          type="button"
                          className="rounded-md p-1 text-pepper-400 hover:bg-paprika-50 hover:text-paprika-600 dark:hover:bg-paprika-950"
                          aria-label={`Delete ${r.title}`}
                          onClick={() => store.deleteReminder(r.id)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        {/* Recently completed */}
        <section aria-label="Recently completed">
          <Card>
            <CardHeader title="Recently completed" subtitle="Keep the momentum." />
            {recentDone.length === 0 ? (
              <EmptyState title="Nothing completed yet" description="Complete a task to see it here." />
            ) : (
              <ul className="space-y-2">
                {recentDone.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 size={15} className="shrink-0 text-basil-500" aria-hidden="true" />
                    <span className="flex-1 truncate font-medium">{t.title}</span>
                    <span className="shrink-0 text-xs text-pepper-400">{timeAgo(t.completedAt ?? '')}</span>
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1 text-pepper-300 hover:bg-butter-100 hover:text-pepper-600 dark:hover:bg-pepper-700"
                      aria-label={`Reopen ${t.title}`}
                      title="Reopen"
                      onClick={() => store.saveTask({ ...t, status: 'BACKLOG', completedAt: undefined })}
                    >
                      <RotateCcw size={13} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>

      <TaskModal open={editModalOpen} onClose={() => setEditModalOpen(false)} editing={editing ?? undefined} projectId={editing?.projectId ?? fallbackProjectId} />
    </div>
  );
}
