-- Run once in the Supabase SQL Editor, using the postgres role.
begin;

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  status text not null default 'active' check (status in ('active', 'completed', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null,
  main_goal text not null default '' check (char_length(main_goal) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_plans_user_date_key unique (user_id, plan_date),
  constraint daily_plans_id_user_key unique (id, user_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_plan_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  completed boolean not null default false,
  estimated_minutes integer not null default 0 check (estimated_minutes between 0 and 1440),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A task and its parent plan must belong to the same user.
  constraint tasks_plan_owner_fkey foreign key (daily_plan_id, user_id)
    references public.daily_plans(id, user_id) on delete cascade
);

create table public.daily_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feedback_date date not null,
  content text not null default '' check (char_length(content) <= 5000),
  energy_level integer check (energy_level between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_feedback_user_date_key unique (user_id, feedback_date)
);

create index goals_user_created_idx on public.goals(user_id, created_at desc);
create index tasks_user_plan_sort_idx on public.tasks(user_id, daily_plan_id, sort_order, created_at);
-- The two user/date unique constraints already index plans and feedback by owner/date.

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

-- Each table gets four separate policies. UPDATE checks both old and new ownership.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['goals', 'daily_plans', 'tasks', 'daily_feedback']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name || '_select_own', table_name);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      table_name || '_insert_own', table_name);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name || '_update_own', table_name);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      table_name || '_delete_own', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_updated_at', table_name);
  end loop;
end;
$$;

revoke all on function public.set_updated_at() from public;
grant usage on schema public to authenticated;
commit;
