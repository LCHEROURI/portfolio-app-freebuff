'use client';

import Link from 'next/link';
import { Scale, Trophy } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useStore } from '@/lib/store';
import { buildComparison } from '@/lib/engine';

const COLUMNS = [
  ['UI', 'uiScore'],
  ['Features', 'featureScore'],
  ['Code', 'codeQualityScore'],
  ['Stability', 'stabilityScore'],
  ['Performance', 'performanceScore'],
  ['Maint.', 'maintainabilityScore'],
  ['Speed', 'developmentSpeedScore'],
  ['Cost', 'costScore'],
  ['Mobile', 'mobileScore'],
  ['A11y', 'accessibilityScore'],
] as const;

export default function ModelComparisonPage() {
  const store = useStore();
  const rows = buildComparison(store);

  return (
    <div>
      <PageHeader
        title="Model Comparison"
        description="Side-by-side weighted scores (1–10) across every evaluated build. Pick a winner per project."
      />

      {rows.length === 0 ? (
        <EmptyState icon={<Scale size={32} aria-hidden="true" />} title="No evaluations yet" description="Add a Model Evaluation on a project's detail page to start comparing builders." />
      ) : (
        <div className="space-y-8">
          {rows.map(({ project, evaluations }) => {
            const sorted = [...evaluations].sort((a, b) => b.overallScore - a.overallScore);
            const winner = sorted[0];
            return (
              <Card key={project.id} className="overflow-x-auto p-0">
                <CardHeader
                  title={
                    <Link href={`/projects/${project.id}`} className="font-display text-base font-bold hover:text-tomato-600">{project.name}</Link>
                  }
                  subtitle={`${evaluations.length} build${evaluations.length === 1 ? '' : 's'} evaluated`}
                  action={
                    project.winningVersionId ? (
                      <Badge tone="basil"><Trophy size={12} aria-hidden="true" /> winner selected</Badge>
                    ) : (
                      <Badge tone="turmeric">winner pending</Badge>
                    )
                  }
                />
                <table className="w-full min-w-[840px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-butter-200 text-xs uppercase tracking-wide text-pepper-400 dark:border-pepper-700">
                      <th className="px-4 py-2.5">Version</th>
                      <th className="px-2 py-2.5">Builder / Model</th>
                      {COLUMNS.map(([label]) => <th key={label} className="px-2 py-2.5 text-center">{label}</th>)}
                      <th className="px-4 py-2.5 text-center">Overall</th>
                      <th className="px-4 py-2.5">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((e) => (
                      <tr key={e.id} className={`border-b border-butter-100 last:border-0 dark:border-pepper-700 ${e.id === winner.id ? 'bg-basil-50 dark:bg-basil-950/30' : ''}`}>
                        <td className="px-4 py-2.5">
                          <p className="font-semibold">{store.versions.find((v) => v.id === e.projectVersionId)?.versionName ?? e.model}</p>
                          <p className="text-xs text-pepper-400">{e.model}</p>
                        </td>
                        <td className="px-2 py-2.5 text-xs">{e.builder}</td>
                        {COLUMNS.map(([label, key]) => (
                          <td key={label} className="px-2 py-2.5 text-center text-xs tabular-nums">{e[key]}</td>
                        ))}
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-lg font-bold tabular-nums ${e.id === winner.id ? 'text-basil-600 dark:text-basil-300' : 'text-pepper-600 dark:text-pepper-300'}`}>{e.overallScore}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          {project.winningVersionId === e.projectVersionId || store.versions.find((v) => v.id === e.projectVersionId)?.isWinner ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-basil-600 dark:text-basil-300">
                              <Trophy size={13} aria-hidden="true" /> Winner
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="text-xs font-medium text-pepper-400 underline-offset-2 hover:text-tomato-600 hover:underline"
                              onClick={() => store.selectWinner(project.id, e.projectVersionId)}
                            >
                              Select winner
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="border-t border-butter-200 px-4 py-3 text-xs text-pepper-400 dark:border-pepper-700">
                  Weights: UI 15% · Features 20% · Code 15% · Stability 15% · Perf 10% · Maint. 10% · Speed 5% · Cost 5% · Mobile 3% · A11y 2%
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
