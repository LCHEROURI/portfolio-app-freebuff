'use client';

import { useState, type FormEvent } from 'react';

import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { useStore } from '@/lib/store';
import {
  type Project, type PriorityLevel, type ProjectStatus,
  PRIORITY_LEVELS, PROJECT_STATUSES, slugify,
} from '@/types';

export const ProjectModal = ({ open, onClose, editing }: {
  open: boolean; onClose: () => void; editing?: Project | null;
}) => {
  const store = useStore();
  const [form, setForm] = useState(() => ({
    name: editing?.name ?? '',
    description: editing?.description ?? '',
    category: editing?.category ?? '',
    businessGoal: editing?.businessGoal ?? '',
    targetCustomer: editing?.targetCustomer ?? '',
    monetizationModel: editing?.monetizationModel ?? '',
    priority: (editing?.priority ?? 'P2_MEDIUM') as PriorityLevel,
    overallStatus: (editing?.overallStatus ?? 'CONCEPT') as ProjectStatus,
    overallProgress: editing?.overallProgress ?? 0,
    nextAction: editing?.nextAction ?? '',
    nextActionDueDate: editing?.nextActionDueDate ?? '',
    blocker: editing?.blocker ?? '',
    notes: editing?.notes ?? '',
  }));

  // Re-seed the form when the modal opens for a different project.
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (open && openKey !== (editing?.id ?? 'new')) {
    setOpenKey(editing?.id ?? 'new');
    setForm({
      name: editing?.name ?? '',
      description: editing?.description ?? '',
      category: editing?.category ?? '',
      businessGoal: editing?.businessGoal ?? '',
      targetCustomer: editing?.targetCustomer ?? '',
      monetizationModel: editing?.monetizationModel ?? '',
      priority: (editing?.priority ?? 'P2_MEDIUM') as PriorityLevel,
      overallStatus: (editing?.overallStatus ?? 'CONCEPT') as ProjectStatus,
      overallProgress: editing?.overallProgress ?? 0,
      nextAction: editing?.nextAction ?? '',
      nextActionDueDate: editing?.nextActionDueDate ?? '',
      blocker: editing?.blocker ?? '',
      notes: editing?.notes ?? '',
    });
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const now = new Date().toISOString();
    const project: Project = editing
      ? { ...editing, ...form, overallProgress: Number(form.overallProgress) || 0, updatedAt: now }
      : {
          id: `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
          userId: store.userId,
          slug: slugify(form.name),
          archived: false,
          createdAt: now,
          updatedAt: now,
          lastActivityAt: now,
          ...form,
          overallProgress: Number(form.overallProgress) || 0,
        };
    await store.saveProject(project);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Project' : 'New Project'} description="A Project is your app concept; versions below it are the different AI builds." wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Weeknight Meal Planner" />
          </Field>
          <Field label="Category">
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Cooking / Meal Planning" />
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as PriorityLevel })}>
              {PRIORITY_LEVELS.map((p) => <option key={p} value={p}>{p.replace('_', ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.overallStatus} onChange={(e) => setForm({ ...form, overallStatus: e.target.value as ProjectStatus })}>
              {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Progress (%)">
            <Input type="number" min={0} max={100} value={form.overallProgress} onChange={(e) => setForm({ ...form, overallProgress: Number(e.target.value) })} />
          </Field>
          <Field label="Business goal" className="sm:col-span-2">
            <Input value={form.businessGoal} onChange={(e) => setForm({ ...form, businessGoal: e.target.value })} placeholder="Validate the concept / grow MRR…" />
          </Field>
          <Field label="Target customer" className="sm:col-span-2">
            <Input value={form.targetCustomer} onChange={(e) => setForm({ ...form, targetCustomer: e.target.value })} placeholder="Who is this for?" />
          </Field>
          <Field label="Monetization model" className="sm:col-span-2">
            <Input value={form.monetizationModel} onChange={(e) => setForm({ ...form, monetizationModel: e.target.value })} placeholder="Freemium / SaaS / One-time…" />
          </Field>
          <Field label="Next action" className="sm:col-span-2">
            <Input value={form.nextAction} onChange={(e) => setForm({ ...form, nextAction: e.target.value })} placeholder="The single most important next step" />
          </Field>
          <Field label="Next action due">
            <Input type="date" value={form.nextActionDueDate} onChange={(e) => setForm({ ...form, nextActionDueDate: e.target.value })} />
          </Field>
          <Field label="Blocker">
            <Input value={form.blocker ?? ''} onChange={(e) => setForm({ ...form, blocker: e.target.value })} placeholder="What's blocking progress?" />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">{editing ? 'Save changes' : 'Create project'}</button>
        </div>
      </form>
    </Modal>
  );
};
