'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, CheckCircle2, CalendarClock, ListTodo, LayoutGrid } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { PriorityBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { TaskModal } from '@/components/tasks/TaskModal';
import { useStore } from '@/lib/store';
import { formatDate } from '@/lib/engine';
import type { Task } from '@/types';

const BOARD_COLUMNS = ['BACKLOG', 'NEXT', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED'] as const;

export default function TasksPage() {
  const store = useStore();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [projectFilter, setProjectFilter] = useState<'ALL' | string>('ALL');

  const tasks = store.tasks
    .filter((t) => projectFilter === 'ALL' || t.projectId === projectFilter)
    .sort((a, b) => a.priority.localeCompare(b.priority) || a.position - b.position);

  const projectName = (id: string) => store.projects.find((p) => p.id === id)?.name ?? 'Unknown';

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Everything on your plate across all projects and builds."
        action={
          <div className="flex items-center gap-2">
            <select
              className="input-base w-auto"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              aria-label="Filter by project"
            >
              <option value="ALL">All projects</option>
              {store.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="flex rounded-lg border border-butter-200 bg-butter-50 p-1 dark:border-pepper-700 dark:bg-pepper-800">
              <button
                type="button"
                aria-label="Board view"
                aria-pressed={view === 'board'}
                onClick={() => setView('board')}
                className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${view === 'board' ? 'bg-tomato-500 text-white' : 'text-pepper-500 hover:bg-butter-100 dark:hover:bg-pepper-700'}`}
              >
                <LayoutGrid size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="List view"
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
                className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${view === 'list' ? 'bg-tomato-500 text-white' : 'text-pepper-500 hover:bg-butter-100 dark:hover:bg-pepper-700'}`}
              >
                <ListTodo size={16} aria-hidden="true" />
              </button>
            </div>
            <button type="button" className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>
              <Plus size={16} aria-hidden="true" /> New Task
            </button>
          </div>
        }
      />

      {tasks.length === 0 ? (
        <EmptyState icon={<ListTodo size={32} aria-hidden="true" />} title="No tasks" description="Create a task to start tracking work." />
      ) : view === 'board' ? (
        <div className="grid gap-4 overflow-x-auto pb-2 sm:grid-cols-2 xl:grid-cols-6" style={{ minWidth: '100%' }}>
          {BOARD_COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col);
            return (
              <div key={col} className="min-w-52 rounded-xl2 border border-butter-200 bg-butter-50/60 p-3 dark:border-pepper-700 dark:bg-pepper-800/60">
                <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-pepper-500 dark:text-pepper-300">
                  {col.replace(/_/g, ' ')} <span className="ml-1 rounded-full bg-butter-200 px-1.5 py-0.5 text-[10px] text-pepper-500 dark:bg-pepper-700">{colTasks.length}</span>
                </h3>
                <div className="space-y-2">
                  {colTasks.map((t) => (
                    <div
                      key={t.id}
                      className="group relative block w-full rounded-xl2 border border-butter-200 bg-white p-3 text-left transition-shadow hover:shadow-card dark:border-pepper-600 dark:bg-pepper-800"
                    >
                      <button
                        type="button"
                        onClick={() => { setEditing(t); setModalOpen(true); }}
                        className="block w-full text-left"
                        aria-label={`Edit ${t.title}`}
                      >
                        <p className="text-sm font-medium leading-snug">{t.title}</p>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <PriorityBadge priority={t.priority} />
                          {t.dueDate && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-pepper-400">
                              <CalendarClock size={11} aria-hidden="true" /> {formatDate(t.dueDate)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-[11px] text-pepper-400">{projectName(t.projectId)}</p>
                      </button>
                      {t.status !== 'COMPLETED' && (
                        <button
                          type="button"
                          className="absolute right-2 top-2 rounded-md p-1 text-basil-500 opacity-0 transition-opacity hover:bg-basil-50 hover:text-basil-700 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-basil-950"
                          aria-label={`Complete ${t.title}`}
                          onClick={() => store.completeTask(t.id)}
                        >
                          <CheckCircle2 size={15} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                  {colTasks.length === 0 && (
                    <p className="rounded-lg border border-dashed border-butter-200 px-2 py-3 text-center text-xs text-pepper-300 dark:border-pepper-700">Empty</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card-base overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-butter-200 text-xs uppercase tracking-wide text-pepper-400 dark:border-pepper-700">
                <th className="px-4 py-3">Task</th>
                <th className="px-2 py-3">Project</th>
                <th className="px-2 py-3">Status</th>
                <th className="px-2 py-3">Priority</th>
                <th className="px-2 py-3">Due</th>
                <th className="px-4 py-3 text-right">Done</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-b border-butter-200 last:border-0 hover:bg-butter-100/60 dark:border-pepper-700 dark:hover:bg-pepper-700/50">
                  <td className="py-3 pl-4">
                    <Link href={`/projects/${t.projectId}`} className="block">
                      <p className="font-medium">{t.title}</p>
                      {t.description && <p className="text-xs text-pepper-400">{t.description}</p>}
                    </Link>
                  </td>
                  <td className="py-3 text-xs text-pepper-500 dark:text-pepper-300">{projectName(t.projectId)}</td>
                  <td className="py-3"><span className="text-xs font-medium uppercase text-pepper-500">{t.status.replace(/_/g, ' ')}</span></td>
                  <td className="py-3"><PriorityBadge priority={t.priority} /></td>
                  <td className="py-3 text-xs">{formatDate(t.dueDate)}</td>
                  <td className="py-3 pr-4 text-right">
                    {t.status !== 'COMPLETED' ? (
                      <button type="button" className="btn-ghost rounded-md p-1.5 text-basil-600 dark:text-basil-400" aria-label={`Complete ${t.title}`} onClick={() => store.completeTask(t.id)}>
                        <CheckCircle2 size={16} aria-hidden="true" />
                      </button>
                    ) : (
                      <span className="text-xs text-basil-500">done</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TaskModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing ?? undefined} projectId={projectFilter === 'ALL' ? store.projects[0]?.id ?? '' : projectFilter} />
    </div>
  );
}
