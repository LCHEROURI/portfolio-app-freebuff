'use client';

import { useState, type FormEvent } from 'react';
import { Save, RotateCcw, User } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { useStore } from '@/lib/store';
import { isFirebaseConfigured } from '@/lib/firebase';

export default function SettingsPage() {
  const store = useStore();
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
            Running in demo mode — data persists in this browser via localStorage. Add <code className="font-mono">NEXT_PUBLIC_FIREBASE_*</code> env vars to switch to Firestore.
          </p>
        )}
      </form>
    </div>
  );
}
