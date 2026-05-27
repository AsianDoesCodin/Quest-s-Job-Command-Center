-- Quest Job Command Center - internal MVP schema
-- Run this in Supabase SQL Editor before wiring the live UI to persisted data.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('owner', 'coowner', 'manager', 'foreman', 'crew');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.job_status as enum ('active', 'on-site', 'in-progress', 'paused', 'pending-schedule', 'scheduled', 'complete', 'delayed');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role public.app_role not null default 'crew',
  can_see_pay boolean generated always as (role in ('owner', 'coowner', 'manager', 'foreman')) stored,
  can_see_burn boolean generated always as (role in ('owner', 'coowner', 'manager')) stored,
  can_edit boolean generated always as (role in ('owner', 'coowner', 'manager', 'foreman')) stored,
  can_log_others boolean generated always as (role in ('owner', 'coowner', 'manager')) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  lat double precision,
  lng double precision,
  geofence_miles numeric not null default 1,
  type text,
  status public.job_status not null default 'pending-schedule',
  start_date date,
  end_date date,
  completed_date date,
  projected_days integer not null default 0,
  days_elapsed integer not null default 0,
  foreman_profile_id uuid references public.profiles(id),
  contract_value numeric not null default 0,
  labor_budget numeric not null default 0,
  material_budget numeric not null default 0,
  daily_burn numeric not null default 0,
  total_burn numeric not null default 0,
  material_status text,
  materials_expected_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  name text not null,
  trade_role text,
  pay_type text not null default 'hourly' check (pay_type in ('hourly', 'daily', 'salary')),
  pay_amount numeric not null default 0,
  initials text,
  color text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.job_assignments (
  job_id uuid not null references public.jobs(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  assigned_role text,
  primary key (job_id, team_member_id)
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  name text not null,
  qty text,
  status text not null default 'pending',
  expected_or_delivered_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.draws (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  name text not null,
  description text,
  pct numeric,
  amount numeric not null default 0,
  status text not null default 'pending',
  date date,
  method text,
  expected_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  worker_profile_id uuid references public.profiles(id) on delete set null,
  worker_name text not null,
  job_id uuid references public.jobs(id) on delete set null,
  task text,
  work_date date not null default current_date,
  clock_in timestamptz,
  clock_out timestamptz,
  hours numeric not null default 0,
  verified boolean not null default false,
  distance numeric,
  flag_reason text,
  clocked_in_by uuid references public.profiles(id) on delete set null,
  admin_entry boolean not null default false,
  manually_edited boolean not null default false,
  submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.time_breaks (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  paid boolean not null default false
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  vendor text not null,
  total numeric not null default 0,
  items jsonb not null default '[]'::jsonb,
  paid_by uuid references public.profiles(id) on delete set null,
  payment_method text,
  receipt_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expense_allocations (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  amount numeric not null default 0
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  author_profile_id uuid references public.profiles(id) on delete set null,
  author_name text not null,
  text text not null,
  job_id uuid references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  bucket text not null,
  path text not null,
  file_type text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.team_members enable row level security;
alter table public.job_assignments enable row level security;
alter table public.materials enable row level security;
alter table public.draws enable row level security;
alter table public.time_entries enable row level security;
alter table public.time_breaks enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_allocations enable row level security;
alter table public.messages enable row level security;
alter table public.files enable row level security;
alter table public.audit_events enable row level security;

create or replace function public.current_app_role()
returns public.app_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_office()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_app_role() in ('owner', 'coowner', 'manager'), false)
$$;

create or replace function public.is_foreman_or_above()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_app_role() in ('owner', 'coowner', 'manager', 'foreman'), false)
$$;

drop policy if exists "profiles read self or office" on public.profiles;
create policy "profiles read self or office" on public.profiles
  for select using (id = auth.uid() or public.is_office());

drop policy if exists "profiles office update" on public.profiles;
create policy "profiles office update" on public.profiles
  for update using (public.is_office()) with check (public.is_office());

drop policy if exists "jobs authenticated read" on public.jobs;
create policy "jobs authenticated read" on public.jobs
  for select using (auth.uid() is not null);

drop policy if exists "jobs foreman write" on public.jobs;
create policy "jobs foreman write" on public.jobs
  for all using (public.is_foreman_or_above()) with check (public.is_foreman_or_above());

drop policy if exists "team authenticated read" on public.team_members;
create policy "team authenticated read" on public.team_members
  for select using (auth.uid() is not null);

drop policy if exists "team office write" on public.team_members;
create policy "team office write" on public.team_members
  for all using (public.is_office()) with check (public.is_office());

drop policy if exists "assignments authenticated read" on public.job_assignments;
create policy "assignments authenticated read" on public.job_assignments
  for select using (auth.uid() is not null);

drop policy if exists "assignments foreman write" on public.job_assignments;
create policy "assignments foreman write" on public.job_assignments
  for all using (public.is_foreman_or_above()) with check (public.is_foreman_or_above());

drop policy if exists "materials authenticated read" on public.materials;
create policy "materials authenticated read" on public.materials
  for select using (auth.uid() is not null);

drop policy if exists "materials foreman write" on public.materials;
create policy "materials foreman write" on public.materials
  for all using (public.is_foreman_or_above()) with check (public.is_foreman_or_above());

drop policy if exists "draws office only" on public.draws;
create policy "draws office only" on public.draws
  for all using (public.is_office()) with check (public.is_office());

drop policy if exists "time entries read own or foreman" on public.time_entries;
create policy "time entries read own or foreman" on public.time_entries
  for select using (worker_profile_id = auth.uid() or public.is_foreman_or_above());

drop policy if exists "time entries write own or foreman" on public.time_entries;
create policy "time entries write own or foreman" on public.time_entries
  for all using (worker_profile_id = auth.uid() or public.is_foreman_or_above()) with check (worker_profile_id = auth.uid() or public.is_foreman_or_above());

drop policy if exists "time breaks via entries" on public.time_breaks;
create policy "time breaks via entries" on public.time_breaks
  for all using (
    exists (
      select 1 from public.time_entries te
      where te.id = time_entry_id and (te.worker_profile_id = auth.uid() or public.is_foreman_or_above())
    )
  ) with check (
    exists (
      select 1 from public.time_entries te
      where te.id = time_entry_id and (te.worker_profile_id = auth.uid() or public.is_foreman_or_above())
    )
  );

drop policy if exists "expenses office only" on public.expenses;
create policy "expenses office only" on public.expenses
  for all using (public.is_office()) with check (public.is_office());

drop policy if exists "expense allocations office only" on public.expense_allocations;
create policy "expense allocations office only" on public.expense_allocations
  for all using (public.is_office()) with check (public.is_office());

drop policy if exists "messages authenticated read" on public.messages;
create policy "messages authenticated read" on public.messages
  for select using (auth.uid() is not null);

drop policy if exists "messages authenticated insert" on public.messages;
create policy "messages authenticated insert" on public.messages
  for insert with check (auth.uid() is not null);

drop policy if exists "files authenticated read" on public.files;
create policy "files authenticated read" on public.files
  for select using (auth.uid() is not null);

drop policy if exists "files foreman write" on public.files;
create policy "files foreman write" on public.files
  for all using (public.is_foreman_or_above()) with check (public.is_foreman_or_above());

drop policy if exists "audit office read" on public.audit_events;
create policy "audit office read" on public.audit_events
  for select using (public.is_office());

drop policy if exists "audit authenticated insert" on public.audit_events;
create policy "audit authenticated insert" on public.audit_events
  for insert with check (auth.uid() is not null);
