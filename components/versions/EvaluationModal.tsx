'use client';

import { useState, type FormEvent } from 'react';

import { Modal } from '@/components/ui/Modal';
import { Field, Textarea } from '@/components/ui/Field';
import { useStore } from '@/lib/store';
import { computeOverallScore, type ModelEvaluation, type ScoreKeys } from '@/types';

const SCORE_FIELDS: { key: ScoreKeys; label: string; weight: number }[] = [
  { key: 'uiScore', label: 'UI / Design', weight: 0.15 },
  { key: 'featureScore', label: 'Feature completeness', weight: 0.2 },
  { key: 'codeQualityScore', label: 'Code quality', weight: 0.15 },
  { key: 'stabilityScore', label: 'Stability', weight: 0.15 },
  { key: 'performanceScore', label: 'Performance', weight: 0.1 },
  { key: 'maintainabilityScore', label: 'Maintainability', weight: 0.1 },
  { key: 'developmentSpeedScore', label: 'Dev speed', weight: 0.05 },
  { key: 'costScore', label: 'Cost', weight: 0.05 },
  { key: 'mobileScore', label: 'Mobile', weight: 0.03 },
  { key: 'accessibilityScore', label: 'Accessibility', weight: 0.02 },
];

const ScoreInput = ({ label, weight, value, onChange }: {
  label: string; weight: number; value: number; onChange: (v: number) => void;
}) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-sm text-pepper-600 dark:text-pepper-200">
      {label} <span className="text-xs text-pepper-400">({Math.round(weight * 100)}%)</span>
    </span>
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${label}: ${n}`}
          className={`h-5 w-5 rounded text-[10px] font-bold transition-colors ${
            value >= n ? 'bg-basil-500 text-white' : 'bg-butter-100 text-pepper-400 hover:bg-butter-200 dark:bg-pepper-700 dark:hover:bg-pepper-600'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  </div>
);

export const EvaluationModal = ({ open, onClose, projectId, versionId }: {
  open: boolean; onClose: () => void; projectId: string; versionId: string;
}) => {
  const store = useStore();
  const version = store.versions.find((v) => v.id === versionId);
  const [scores, setScores] = useState<Record<ScoreKeys, number>>(() => {
    const init = {} as Record<ScoreKeys, number>;
    SCORE_FIELDS.forEach((f) => { init[f.key] = 7; });
    return init;
  });
  const [notes, setNotes] = useState('');

  const overall = computeOverallScore(scores);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!version) return;
    const now = new Date().toISOString();
    const evaluation: ModelEvaluation = {
      id: `e-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      userId: store.userId,
      projectId,
      projectVersionId: version.id,
      builder: version.builder,
      model: version.model,
      ...scores,
      overallScore: overall,
      evaluatorNotes: notes || undefined,
      evaluatedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await store.saveEvaluation(evaluation);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Score Model Evaluation" description={version ? `${version.versionName} — ${version.builder} / ${version.model}` : 'Select a version first'} wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          {SCORE_FIELDS.map((f) => (
            <ScoreInput
              key={f.key}
              label={f.label}
              weight={f.weight}
              value={scores[f.key]}
              onChange={(v) => setScores({ ...scores, [f.key]: v })}
            />
          ))}
        </div>
        <div className="flex items-center justify-between rounded-xl2 bg-basil-50 px-4 py-3 dark:bg-basil-950/50">
          <span className="text-sm font-medium text-basil-700 dark:text-basil-200">Weighted overall score</span>
          <span className="text-2xl font-bold text-basil-600 dark:text-basil-300">{overall}/10</span>
        </div>
        <Field label="Evaluator notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What stood out, what to fix…" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">Save evaluation</button>
        </div>
      </form>
    </Modal>
  );
};
