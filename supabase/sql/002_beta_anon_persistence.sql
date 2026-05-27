-- Quest Job Command Center - live beta persistence
--
-- Run this in the Supabase SQL Editor for the live beta app.
--
-- This is intentionally simple and permissive while the app does not have
-- real Supabase Auth yet. It stores each UI entity as JSON so the current
-- frontend can persist data immediately.
--
-- SECURITY NOTE:
-- These anon policies allow anyone with the public app key to read/write these
-- beta tables. That is acceptable only for a private beta/testing link. Replace
-- these policies with authenticated, role-based RLS before using real customer,
-- payroll, payment, or personally sensitive data.

create table if not exists public.app_jobs (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_team_members (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_time_entries (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_expenses (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_messages (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_jobs_touch_updated_at on public.app_jobs;
create trigger app_jobs_touch_updated_at
before update on public.app_jobs
for each row execute function public.touch_updated_at();

drop trigger if exists app_team_members_touch_updated_at on public.app_team_members;
create trigger app_team_members_touch_updated_at
before update on public.app_team_members
for each row execute function public.touch_updated_at();

drop trigger if exists app_time_entries_touch_updated_at on public.app_time_entries;
create trigger app_time_entries_touch_updated_at
before update on public.app_time_entries
for each row execute function public.touch_updated_at();

drop trigger if exists app_expenses_touch_updated_at on public.app_expenses;
create trigger app_expenses_touch_updated_at
before update on public.app_expenses
for each row execute function public.touch_updated_at();

drop trigger if exists app_messages_touch_updated_at on public.app_messages;
create trigger app_messages_touch_updated_at
before update on public.app_messages
for each row execute function public.touch_updated_at();

alter table public.app_jobs enable row level security;
alter table public.app_team_members enable row level security;
alter table public.app_time_entries enable row level security;
alter table public.app_expenses enable row level security;
alter table public.app_messages enable row level security;

drop policy if exists "beta anon app_jobs select" on public.app_jobs;
create policy "beta anon app_jobs select" on public.app_jobs
for select to anon using (true);

drop policy if exists "beta anon app_jobs insert" on public.app_jobs;
create policy "beta anon app_jobs insert" on public.app_jobs
for insert to anon with check (true);

drop policy if exists "beta anon app_jobs update" on public.app_jobs;
create policy "beta anon app_jobs update" on public.app_jobs
for update to anon using (true) with check (true);

drop policy if exists "beta anon app_jobs delete" on public.app_jobs;
create policy "beta anon app_jobs delete" on public.app_jobs
for delete to anon using (true);

drop policy if exists "beta anon app_team_members select" on public.app_team_members;
create policy "beta anon app_team_members select" on public.app_team_members
for select to anon using (true);

drop policy if exists "beta anon app_team_members insert" on public.app_team_members;
create policy "beta anon app_team_members insert" on public.app_team_members
for insert to anon with check (true);

drop policy if exists "beta anon app_team_members update" on public.app_team_members;
create policy "beta anon app_team_members update" on public.app_team_members
for update to anon using (true) with check (true);

drop policy if exists "beta anon app_team_members delete" on public.app_team_members;
create policy "beta anon app_team_members delete" on public.app_team_members
for delete to anon using (true);

drop policy if exists "beta anon app_time_entries select" on public.app_time_entries;
create policy "beta anon app_time_entries select" on public.app_time_entries
for select to anon using (true);

drop policy if exists "beta anon app_time_entries insert" on public.app_time_entries;
create policy "beta anon app_time_entries insert" on public.app_time_entries
for insert to anon with check (true);

drop policy if exists "beta anon app_time_entries update" on public.app_time_entries;
create policy "beta anon app_time_entries update" on public.app_time_entries
for update to anon using (true) with check (true);

drop policy if exists "beta anon app_time_entries delete" on public.app_time_entries;
create policy "beta anon app_time_entries delete" on public.app_time_entries
for delete to anon using (true);

drop policy if exists "beta anon app_expenses select" on public.app_expenses;
create policy "beta anon app_expenses select" on public.app_expenses
for select to anon using (true);

drop policy if exists "beta anon app_expenses insert" on public.app_expenses;
create policy "beta anon app_expenses insert" on public.app_expenses
for insert to anon with check (true);

drop policy if exists "beta anon app_expenses update" on public.app_expenses;
create policy "beta anon app_expenses update" on public.app_expenses
for update to anon using (true) with check (true);

drop policy if exists "beta anon app_expenses delete" on public.app_expenses;
create policy "beta anon app_expenses delete" on public.app_expenses
for delete to anon using (true);

drop policy if exists "beta anon app_messages select" on public.app_messages;
create policy "beta anon app_messages select" on public.app_messages
for select to anon using (true);

drop policy if exists "beta anon app_messages insert" on public.app_messages;
create policy "beta anon app_messages insert" on public.app_messages
for insert to anon with check (true);

drop policy if exists "beta anon app_messages update" on public.app_messages;
create policy "beta anon app_messages update" on public.app_messages
for update to anon using (true) with check (true);

drop policy if exists "beta anon app_messages delete" on public.app_messages;
create policy "beta anon app_messages delete" on public.app_messages
for delete to anon using (true);
