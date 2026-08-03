-- ============================================================================
-- App Portfolio Command Center — Supabase schema
-- Run this in the Supabase SQL Editor (or `supabase db push`) to provision the
-- live Tasks + Reminders backend. The app talks to these tables through its
-- own server-side API routes using the service-role key, so every query is
-- scoped by `owner_id` in code; RLS below is defense-in-depth for the case
-- where a client key is ever used directly.
-- ============================================================================

-- ─── Tasks ───────────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id                  text primary key,
  owner_id            text not null,             -- Firebase uid / app user id
  project_id          text not null default '',
  project_version_id  text,
  title               text not null,
  description         text,
  status              text not null default 'BACKLOG',
  priority            text not null default 'P2_MEDIUM',
  task_type           text not null default 'FEATURE',
  due_date            text,                       -- ISO or YYYY-MM-DD
  reminder_date       text,
  completed_at        text,
  estimated_minutes   integer,
  actual_minutes      integer,
  blocked_by          text,
  source              text,
  position            integer not null default 0,
  created_at          text not null,
  updated_at          text not null
);

create index if not exists tasks_owner_idx on public.tasks (owner_id);
create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists tasks_due_idx on public.tasks (due_date);

-- ─── Reminders ───────────────────────────────────────────────────────────────
create table if not exists public.reminders (
  id          text primary key,
  owner_id    text not null,
  project_id  text,
  title       text not null,
  note        text,
  remind_at   text not null,                     -- ISO or YYYY-MM-DDTHH:mm
  done        boolean not null default false,
  created_at  text not null,
  updated_at  text not null
);

create index if not exists reminders_owner_idx on public.reminders (owner_id);
create index if not exists reminders_remind_at_idx on public.reminders (remind_at);

-- ─── Row Level Security ──────────────────────────────────────────────────────
-- Owner-scoped policies keyed on auth.uid() (text comparison against owner_id).
-- The app's server routes use the service-role key (RLS bypassed) but these
-- policies guarantee a leaked anon/authenticated key can never read or write
-- another user's rows.

alter table public.tasks enable row level security;
alter table public.reminders enable row level security;

drop policy if exists tasks_owner_select on public.tasks;
drop policy if exists tasks_owner_insert on public.tasks;
drop policy if exists tasks_owner_update on public.tasks;
drop policy if exists tasks_owner_delete on public.tasks;

create policy tasks_owner_select on public.tasks
  for select using (auth.uid()::text = owner_id);
create policy tasks_owner_insert on public.tasks
  for insert with check (auth.uid()::text = owner_id);
create policy tasks_owner_update on public.tasks
  for update using (auth.uid()::text = owner_id);
create policy tasks_owner_delete on public.tasks
  for delete using (auth.uid()::text = owner_id);

drop policy if exists reminders_owner_select on public.reminders;
drop policy if exists reminders_owner_insert on public.reminders;
drop policy if exists reminders_owner_update on public.reminders;
drop policy if exists reminders_owner_delete on public.reminders;

create policy reminders_owner_select on public.reminders
  for select using (auth.uid()::text = owner_id);
create policy reminders_owner_insert on public.reminders
  for insert with check (auth.uid()::text = owner_id);
create policy reminders_owner_update on public.reminders
  for update using (auth.uid()::text = owner_id);
create policy reminders_owner_delete on public.reminders
  for delete using (auth.uid()::text = owner_id);
