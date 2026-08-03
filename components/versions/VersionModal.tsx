'use client';

import { useState, type FormEvent } from 'react';

import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { useStore } from '@/lib/store';
import { type ProjectVersion, type ProjectStatus, PROJECT_STATUSES } from '@/types';

const BUILDER_SUGGESTIONS = [
  'Gemini', 'Google AI Studio', 'DeepSeek', 'Lovable', 'Replit', 'Claude',
  'Cursor', 'Codex', 'Anti-Gravity', 'FreeBuff', 'Kimi K3', 'ChatGPT', 'Other',
];

export const VersionModal = ({ open, onClose, editing, projectId }: {
  open: boolean; onClose: () => void; editing?: ProjectVersion; projectId: string;
}) => {
  const store = useStore();
  const [form, setForm] = useState(() => ({
    versionName: editing?.versionName ?? '',
    builder: editing?.builder ?? '',
    model: editing?.model ?? '',
    modelVersion: editing?.modelVersion ?? '',
    developmentPlatform: editing?.developmentPlatform ?? '',
    status: (editing?.status ?? 'CONCEPT') as ProjectStatus,
    progress: editing?.progress ?? 0,
    branch: editing?.branch ?? 'main',
    localFolderPath: editing?.localFolderPath ?? '',
    estimatedCost: editing?.estimatedCost ?? 0,
    actualCost: editing?.actualCost ?? 0,
    developmentHours: editing?.developmentHours ?? 0,
    notes: editing?.notes ?? '',
  }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.versionName.trim() || !form.builder.trim() || !form.model.trim()) return;
    const now = new Date().toISOString();
    const version: ProjectVersion = editing
      ? { ...editing, ...form, progress: Number(form.progress) || 0, updatedAt: now }
      : {
          id: `v-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
          projectId,
          userId: store.userId,
          deploymentIds: [],
          isWinner: false,
          isArchived: false,
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
          ...form,
          progress: Number(form.progress) || 0,
        };
    await store.saveVersion(version);
    // Keep the project's current version pointing at something real.
    const project = store.projects.find((p) => p.id === projectId);
    if (project && !project.currentVersionId) {
      await store.saveProject({ ...project, currentVersionId: version.id });
    }
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Version' : 'Add Version'} description="A version is one implementation of the project — e.g. the Gemini build vs the Codex build." wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Version name">
            <Input required value={form.versionName} onChange={(e) => setForm({ ...form, versionName: e.target.value })} placeholder="Gemini Build" />
          </Field>
          <Field label="Builder / Platform">
            <Input required list="builder-suggestions" value={form.builder} onChange={(e) => setForm({ ...form, builder: e.target.value })} placeholder="Gemini, Lovable, Replit…" />
            <datalist id="builder-suggestions">
              {BUILDER_SUGGESTIONS.map((b) => <option key={b} value={b} />)}
            </datalist>
          </Field>
          <Field label="Model">
            <Input required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="Gemini 1.5 Pro" />
          </Field>
          <Field label="Model version">
            <Input value={form.modelVersion ?? ''} onChange={(e) => setForm({ ...form, modelVersion: e.target.value })} placeholder="optional" />
          </Field>
          <Field label="Development platform">
            <Input value={form.developmentPlatform} onChange={(e) => setForm({ ...form, developmentPlatform: e.target.value })} placeholder="Next.js + Vercel" />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}>
              {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Progress (%)">
            <Input type="number" min={0} max={100} value={form.progress} onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })} />
          </Field>
          <Field label="Branch">
            <Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
          </Field>
          <Field label="Local folder path" className="sm:col-span-2">
            <Input value={form.localFolderPath ?? ''} onChange={(e) => setForm({ ...form, localFolderPath: e.target.value })} placeholder="~/dev/weeknight-planner/gemini" />
          </Field>
          <Field label="Estimated cost ($)">
            <Input type="number" min={0} value={form.estimatedCost} onChange={(e) => setForm({ ...form, estimatedCost: Number(e.target.value) })} />
          </Field>
          <Field label="Actual cost ($)">
            <Input type="number" min={0} value={form.actualCost} onChange={(e) => setForm({ ...form, actualCost: Number(e.target.value) })} />
          </Field>
          <Field label="Dev hours">
            <Input type="number" min={0} value={form.developmentHours} onChange={(e) => setForm({ ...form, developmentHours: Number(e.target.value) })} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">{editing ? 'Save changes' : 'Add version'}</button>
        </div>
      </form>
    </Modal>
  );
};
