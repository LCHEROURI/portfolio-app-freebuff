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

-- ─── Projects ───────────────────────────────────────────────────────────────
-- Owned by the same owner_id used for tasks. Persisted through the app's live
-- API routes so the automation engine (cron) can evaluate project-level rules
-- (stale, no-next-task, missing-winner, …) against real data.
create table if not exists public.projects (
  id                    text primary key,
  owner_id              text not null,
  name                  text not null,
  slug                  text not null default '',
  description           text not null default '',
  category              text not null default '',
  business_goal         text not null default '',
  target_customer       text not null default '',
  monetization_model    text not null default '',
  priority              text not null default 'P2_MEDIUM',
  overall_status        text not null default 'CONCEPT',
  overall_progress      integer not null default 0,
  winning_version_id    text,
  current_version_id    text,
  next_action           text not null default '',
  next_action_due_date  text,
  blocker               text,
  notes                 text,
  winner_recommendation text,
  winner_recommendation_model text,
  archived              boolean not null default false,
  created_at            text not null,
  updated_at            text not null,
  last_activity_at      text not null
);

create index if not exists projects_owner_idx on public.projects (owner_id);
create index if not exists projects_updated_idx on public.projects (updated_at);

-- Columns added after initial provisioning; safe to run again.
alter table public.projects add column if not exists winner_recommendation text;
alter table public.projects add column if not exists winner_recommendation_model text;

-- ─── Versions (per-model implementations) ───────────────────────────────────
create table if not exists public.versions (
  id                       text primary key,
  project_id               text not null,
  owner_id                 text not null,
  version_name             text not null,
  builder                  text not null,
  model                    text not null,
  model_version            text,
  development_platform     text not null default '',
  status                   text not null default 'BUILDING',
  progress                 integer not null default 0,
  local_folder_path        text,
  repository_id            text,
  deployment_ids           text[] not null default '{}',
  primary_deployment_id    text,
  branch                   text not null default 'main',
  current_milestone_id     text,
  next_task_id             text,
  blocker                  text,
  last_commit_at           text,
  last_deployment_at       text,
  last_activity_at         text not null,
  estimated_cost           numeric not null default 0,
  actual_cost              numeric not null default 0,
  development_hours        numeric not null default 0,
  is_winner                boolean not null default false,
  is_archived              boolean not null default false,
  notes                    text,
  created_at               text not null,
  updated_at               text not null
);

create index if not exists versions_owner_idx on public.versions (owner_id);
create index if not exists versions_project_idx on public.versions (project_id);

-- ─── Model Evaluations ──────────────────────────────────────────────────────
create table if not exists public.evaluations (
  id                       text primary key,
  owner_id                 text not null,
  project_id               text not null,
  project_version_id       text not null,
  builder                  text not null default '',
  model                    text not null default '',
  ui_score                 integer not null default 0,
  feature_score            integer not null default 0,
  code_quality_score       integer not null default 0,
  stability_score          integer not null default 0,
  performance_score        integer not null default 0,
  maintainability_score    integer not null default 0,
  mobile_score             integer not null default 0,
  accessibility_score      integer not null default 0,
  development_speed_score  integer not null default 0,
  cost_score               integer not null default 0,
  overall_score            numeric not null default 0,
  evaluator_notes          text,
  evaluated_at             text not null,
  created_at               text not null,
  updated_at               text not null
);

create index if not exists evaluations_owner_idx on public.evaluations (owner_id);
create index if not exists evaluations_project_idx on public.evaluations (project_id);
create index if not exists evaluations_version_idx on public.evaluations (project_version_id);

-- ─── Activity (report delivery history + event feed) ────────────────────────
-- Shared by the client store (Save and email now / retry) and the cron (every
-- scheduled send) so the Activity page shows the full email delivery history.
create table if not exists public.activity (
  id                    text primary key,
  owner_id              text not null,
  project_id            text,
  project_version_id    text,
  kind                  text not null default 'report_generated',
  message               text not null,
  created_at            text not null
);

create index if not exists activity_owner_idx on public.activity (owner_id);
create index if not exists activity_created_idx on public.activity (created_at);

alter table public.activity enable row level security;

drop policy if exists activity_owner_select on public.activity;
drop policy if exists activity_owner_insert on public.activity;
drop policy if exists activity_owner_update on public.activity;
drop policy if exists activity_owner_delete on public.activity;

create policy activity_owner_select on public.activity
  for select using (auth.uid()::text = owner_id);
create policy activity_owner_insert on public.activity
  for insert with check (auth.uid()::text = owner_id);
create policy activity_owner_update on public.activity
  for update using (auth.uid()::text = owner_id);
create policy activity_owner_delete on public.activity
  for delete using (auth.uid()::text = owner_id);

-- ─── RLS for projects / versions / evaluations ─────────────────────────────
-- Same owner-scoped policy shape as tasks/reminders (defense-in-depth; the
-- app's server routes use the service-role key which bypasses RLS).

alter table public.projects enable row level security;
alter table public.versions enable row level security;
alter table public.evaluations enable row level security;

drop policy if exists projects_owner_select on public.projects;
drop policy if exists projects_owner_insert on public.projects;
drop policy if exists projects_owner_update on public.projects;
drop policy if exists projects_owner_delete on public.projects;

create policy projects_owner_select on public.projects
  for select using (auth.uid()::text = owner_id);
create policy projects_owner_insert on public.projects
  for insert with check (auth.uid()::text = owner_id);
create policy projects_owner_update on public.projects
  for update using (auth.uid()::text = owner_id);
create policy projects_owner_delete on public.projects
  for delete using (auth.uid()::text = owner_id);

drop policy if exists versions_owner_select on public.versions;
drop policy if exists versions_owner_insert on public.versions;
drop policy if exists versions_owner_update on public.versions;
drop policy if exists versions_owner_delete on public.versions;

create policy versions_owner_select on public.versions
  for select using (auth.uid()::text = owner_id);
create policy versions_owner_insert on public.versions
  for insert with check (auth.uid()::text = owner_id);
create policy versions_owner_update on public.versions
  for update using (auth.uid()::text = owner_id);
create policy versions_owner_delete on public.versions
  for delete using (auth.uid()::text = owner_id);

drop policy if exists evaluations_owner_select on public.evaluations;
drop policy if exists evaluations_owner_insert on public.evaluations;
drop policy if exists evaluations_owner_update on public.evaluations;
drop policy if exists evaluations_owner_delete on public.evaluations;

create policy evaluations_owner_select on public.evaluations
  for select using (auth.uid()::text = owner_id);
create policy evaluations_owner_insert on public.evaluations
  for insert with check (auth.uid()::text = owner_id);
create policy evaluations_owner_update on public.evaluations
  for update using (auth.uid()::text = owner_id);
create policy evaluations_owner_delete on public.evaluations
  for delete using (auth.uid()::text = owner_id);
