'use client';

import { useState, type FormEvent } from 'react';
import { Database, LogOut, Save, RotateCcw, Sparkles, User } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { VercelEnvSettingsLink } from '@/components/integrations/VercelEnvSettingsLink';
import { useStore } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { isFirebaseConfigured } from '@/lib/firebase';

export default function SettingsPage() {
  const store = useStore();
  const { user } = useAuth();
  const [form, setForm] = useState(() => ({
    name: store.profile.name,
    email: store.profile.email,
    timezone: store.profile.timezone,
    dailyReportEnabled: store.profile.dailyReportEnabled,
    dailyReportTime: store.profile.dailyReportTime,
    weeklyReportEnabled: store.profile.weeklyReportEnabled,
    weeklyReportDay: store.profile.weeklyReportDay,
    weeklyReportTime: store.profile.weeklyReportTime,
    defaultStaleDays: store.profile.defaultStaleDays,
    aiModel: store.profile.aiModel ?? '',
  }));
  const [saved, setSaved] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await store.saveProfile({ ...store.profile, ...form, updatedAt: new Date().toISOString() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <PageHeader title="Settings" description="Profile, report schedules, and automation thresholds." />

      {isFirebaseConfigured() && (
        <Card className="mb-6">
          <CardHeader title="Account" subtitle="Your Command Center syncs to Firestore under this account." action={<User size={18} className="text-pepper-400" aria-hidden="true" />} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-medium text-pepper-900 dark:text-flour-50">{user?.displayName || user?.email || 'Signed in'}</p>
              <p className="text-pepper-500 dark:text-pepper-300">{user?.email ?? ''} · data isolated per user</p>
            </div>
            <button
              type="button"
              className="btn-ghost border border-butter-200 px-3 py-1.5 text-sm dark:border-pepper-700"
              onClick={async () => { await store.signOut(); }}
            >
              <LogOut size={15} aria-hidden="true" /> Sign out
            </button>
          </div>
        </Card>
      )}

      {isFirebaseConfigured() && store.hasLocalDemoData && !store.migrationDismissed && (
        <Card className="mb-6 border-basil-300 bg-basil-50 dark:border-basil-800 dark:bg-basil-950/60">
          <CardHeader title="Import demo data" subtitle="Local demo data from this browser is still on disk. Import it into your account so it syncs everywhere." action={<Database size={18} className="text-basil-600 dark:text-basil-300" aria-hidden="true" />} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                const count = await store.migrateLocalDemo();
                if (count > 0) alert(`Imported ${count} records into your account.`);
              }}
            >
              <Database size={15} aria-hidden="true" /> Import demo data
            </button>
            <button
              type="button"
              className="btn-ghost text-sm"
              onClick={() => store.dismissLocalDemoMigrate()}
            >
              Not now
            </button>
          </div>
        </Card>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader title="Profile" subtitle="Who this Command Center works for." action={<User size={18} className="text-pepper-400" aria-hidden="true" />} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Timezone">
              <Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="America/Los_Angeles" />
            </Field>
            <Field label="Stale threshold (days)" hint="Rule 1 & 8 use this to decide when a project is stale.">
              <Input type="number" min={1} max={90} value={form.defaultStaleDays} onChange={(e) => setForm({ ...form, defaultStaleDays: Number(e.target.value) })} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Daily report" subtitle="Summarizes attention items, overdue tasks, and top 3 actions." />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.dailyReportEnabled}
                onChange={(e) => setForm({ ...form, dailyReportEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-butter-300 text-tomato-600 focus:ring-tomato-500"
              />
              Enable daily report
            </label>
            <Field label="Send time">
              <Input type="time" value={form.dailyReportTime} onChange={(e) => setForm({ ...form, dailyReportTime: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="AI summaries"
            subtitle="Which OpenRouter model writes your report executive summaries. Leave empty to use the OPENROUTER_MODEL server default."
            action={<Sparkles size={18} className="text-eggplant-500" aria-hidden="true" />}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="OpenRouter model id"
              hint="Any model id OpenRouter serves — e.g. deepseek/deepseek-chat or anthropic/claude-3.5-sonnet. Swap freely to A/B the very models you track here."
            >
              <Input
                value={form.aiModel}
                maxLength={120}
                onChange={(e) => setForm({ ...form, aiModel: e.target.value })}
                placeholder="deepseek/deepseek-chat"
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Weekly report" subtitle="Projects advanced, deployment health, model performance breakdown, winner recommendations." />
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.weeklyReportEnabled}
                onChange={(e) => setForm({ ...form, weeklyReportEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-butter-300 text-tomato-600 focus:ring-tomato-500"
              />
              Enable weekly report
            </label>
            <Field label="Day (0=Sun)">
              <Select value={form.weeklyReportDay} onChange={(e) => setForm({ ...form, weeklyReportDay: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                  <option key={d} value={d}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Send time">
              <Input type="time" value={form.weeklyReportTime} onChange={(e) => setForm({ ...form, weeklyReportTime: e.target.value })} />
            </Field>
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary">
            <Save size={15} aria-hidden="true" /> {saved ? 'Saved ✓' : 'Save settings'}
          </button>
          {store.mode === 'demo' && (
            <button
              type="button"
              className="btn-ghost text-paprika-500"
              onClick={async () => {
                await store.resetDemo();
                window.location.reload();
              }}
            >
              <RotateCcw size={15} aria-hidden="true" /> Reset demo data
            </button>
          )}
        </div>

        {!isFirebaseConfigured() && (
          <p className="text-xs text-pepper-400">
            Running in demo mode — data persists in this browser via localStorage. Add{' '}
            <code className="font-mono">NEXT_PUBLIC_FIREBASE_*</code> env vars to switch to Firestore, or{' '}
            <VercelEnvSettingsLink label="wire live integrations in Vercel env settings" />
            .
          </p>
        )}
      </form>
    </div>
  );
}
