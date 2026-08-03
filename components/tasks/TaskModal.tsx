'use client';

import { useState, type FormEvent } from 'react';

import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { useStore } from '@/lib/store';
import {
  type Task, type TaskStatus, type TaskType, type PriorityLevel,
  TASK_STATUSES, TASK_TYPES, PRIORITY_LEVELS,
} from '@/types';

export const TaskModal = ({ open, onClose, editing, projectId }: {
  open: boolean; onClose: () => void; editing?: Task; projectId: string;
}) => {
  const store = useStore();
  const [form, setForm] = useState(() => ({
    title: editing?.title ?? '',
    description: editing?.description ?? '',
    status: (editing?.status ?? 'BACKLOG') as TaskStatus,
    priority: (editing?.priority ?? 'P2_MEDIUM') as PriorityLevel,
    taskType: (editing?.taskType ?? 'FEATURE') as TaskType,
    dueDate: editing?.dueDate ?? '',
    estimatedMinutes: editing?.estimatedMinutes ?? 60,
    blockedBy: editing?.blockedBy ?? '',
  }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    const now = new Date().toISOString();
    const task: Task = editing
      ? { ...editing, ...form, dueDate: form.dueDate || undefined, updatedAt: now }
      : {
          id: `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
          projectId,
          position: store.tasks.filter((x) => x.projectId === projectId).length,
          createdAt: now,
          updatedAt: now,
          ...form,
          dueDate: form.dueDate || undefined,
        };
    await store.saveTask(task);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Task' : 'Add Task'} description="A task belongs to a project and optionally a specific version build.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Title">
          <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Wire voice pantry input" />
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as PriorityLevel })}>
              {PRIORITY_LEVELS.map((p) => <option key={p} value={p}>{p.replace('_', ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value as TaskType })}>
              {TASK_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Due date">
            <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </Field>
          <Field label="Est. minutes">
            <Input type="number" min={0} value={form.estimatedMinutes ?? ''} onChange={(e) => setForm({ ...form, estimatedMinutes: Number(e.target.value) })} />
          </Field>
          <Field label="Blocked by">
            <Input value={form.blockedBy ?? ''} onChange={(e) => setForm({ ...form, blockedBy: e.target.value })} placeholder="External API review…" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">{editing ? 'Save changes' : 'Add task'}</button>
        </div>
      </form>
    </Modal>
  );
};
