'use client';

import Link from 'next/link';
import { CalendarClock, AlertCircle, TrendingUp, CheckCircle2, ChevronRight } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { PriorityBadge, StatusBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useStore } from '@/lib/store';
import { buildTopThree, isDueToday, isOverdue, timeAgo } from '@/lib/engine';

export default function TodayPage() {
  const store = useStore();
  const topThree = buildTopThree(store);
  const dueToday = store.tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELED' && isDueToday(t.dueDate));
  const overdue = store.tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELED' && isOverdue(t.dueDate));
  const reminders = store.tasks.filter((t) => t.reminderDate && isDueToday(t.reminderDate) && t.status !== 'COMPLETED' && t.status !== 'CANCELED');
  const recentlyDone = store.tasks
    .filter((t) => t.status === 'COMPLETED')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, 5);

  const projectName = (id: string) => store.projects.find((p) => p.id === id)?.name ?? 'Unknown';

  return (
    <div>
      <PageHeader
        title="Today"
        description={`${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} — focus on what moves the needle.`}
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
                  <div>
                    <p className="font-semibold text-pepper-900 dark:text-flour-50">{action.title}</p>
                    <p className="text-sm text-pepper-500 dark:text-pepper-300">{action.description}</p>
                  </div>
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
            {dueToday.length === 0 ? (
              <p className="text-sm text-pepper-500 dark:text-pepper-300">Nothing due today.</p>
            ) : (
              <ul className="space-y-2">
                {dueToday.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 rounded-xl2 border border-butter-200 p-3 dark:border-pepper-700">
                    <button type="button" className="text-basil-500 hover:text-basil-700" aria-label={`Complete ${t.title}`} onClick={() => store.completeTask(t.id)}>
                      <CheckCircle2 size={18} aria-hidden="true" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{t.title}</p>
                      <p className="text-xs text-pepper-400">{projectName(t.projectId)}</p>
                    </div>
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
                      <Link href={`/projects/${t.projectId}`} className="min-w-0 flex-1">
                        <p className="truncate font-medium text-paprika-700 dark:text-paprika-200">{t.title}</p>
                        <p className="text-xs text-paprika-500 dark:text-paprika-300">{projectName(t.projectId)} · due {new Date(t.dueDate!).toLocaleDateString()}</p>
                      </Link>
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
            <CardHeader title="Reminders" subtitle="Tasks with a reminder set for today." />
            {reminders.length === 0 ? (
              <p className="text-sm text-pepper-500 dark:text-pepper-300">No reminders for today.</p>
            ) : (
              <ul className="space-y-2">
                {reminders.map((t) => (
                  <li key={t.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{t.title}</span>
                    <Link href={`/projects/${t.projectId}`} className="text-pepper-400 hover:text-tomato-600"><ChevronRight size={16} aria-hidden="true" /></Link>
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
            {recentlyDone.length === 0 ? (
              <EmptyState title="Nothing completed yet" description="Complete a task to see it here." />
            ) : (
              <ul className="space-y-2">
                {recentlyDone.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 size={15} className="shrink-0 text-basil-500" aria-hidden="true" />
                    <span className="flex-1 truncate font-medium">{t.title}</span>
                    <span className="shrink-0 text-xs text-pepper-400">{timeAgo(t.completedAt ?? '')}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
