-- Run once AFTER 001_initial_schema.sql. Existing plans and RLS policies remain intact.
begin;
alter table public.tasks
  add column reason text not null default '' check (char_length(reason) <= 1000),
  add column success_criteria text not null default '' check (char_length(success_criteria) <= 1000);

-- Atomic save; SECURITY INVOKER preserves the caller's RLS and table permissions.
create function public.adopt_tomorrow_plan(p_source_date date, p_proposal jsonb, p_plan_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  today_date date := (statement_timestamp() at time zone 'Asia/Shanghai')::date;
  target_date date;
  saved_id uuid;
  task_item jsonb;
  field_name text;
  task_title text;
  seen_titles text[] := array[]::text[];
  task_index integer := 0;
begin
  if owner_id is null then
    raise exception using errcode = 'PT401', message = 'Authentication required';
  end if;
  if p_source_date is distinct from today_date then
    raise exception using errcode = 'PT410', message = 'Source date expired';
  end if;
  if p_plan_id is null or jsonb_typeof(p_proposal) is distinct from 'object' then
    raise exception using errcode = 'PT422', message = 'Invalid proposal';
  end if;
  if not (p_proposal ?& array['today_summary','adjustment_reason','tomorrow_main_goal','tasks'])
     or (select count(*) from jsonb_object_keys(p_proposal)) <> 4 then
    raise exception using errcode = 'PT422', message = 'Invalid proposal keys';
  end if;
  foreach field_name in array array['today_summary','adjustment_reason','tomorrow_main_goal'] loop
    if jsonb_typeof(p_proposal -> field_name) is distinct from 'string'
       or char_length(btrim(p_proposal ->> field_name)) = 0
       or char_length(p_proposal ->> field_name) > (case when field_name = 'tomorrow_main_goal' then 1000 else 1600 end) then
      raise exception using errcode = 'PT422', message = 'Invalid proposal text';
    end if;
  end loop;
  if jsonb_typeof(p_proposal -> 'tasks') is distinct from 'array' then
    raise exception using errcode = 'PT422', message = 'Tasks must be an array';
  end if;
  if jsonb_array_length(p_proposal -> 'tasks') > 3 then
    raise exception using errcode = 'PT422', message = 'At most three tasks';
  end if;
  for task_item in select value from jsonb_array_elements(p_proposal -> 'tasks') loop
    if jsonb_typeof(task_item) is distinct from 'object' then
      raise exception using errcode = 'PT422', message = 'Invalid task';
    end if;
    if not (task_item ?& array['title','estimated_minutes','reason','success_criteria'])
       or (select count(*) from jsonb_object_keys(task_item)) <> 4 then
      raise exception using errcode = 'PT422', message = 'Invalid task keys';
    end if;
    foreach field_name in array array['title','reason','success_criteria'] loop
      if jsonb_typeof(task_item -> field_name) is distinct from 'string'
         or char_length(btrim(task_item ->> field_name)) = 0
         or char_length(task_item ->> field_name) > (case when field_name = 'title' then 200 else 1000 end) then
        raise exception using errcode = 'PT422', message = 'Invalid task text';
      end if;
    end loop;
    if jsonb_typeof(task_item -> 'estimated_minutes') is distinct from 'number' then
      raise exception using errcode = 'PT422', message = 'Invalid duration type';
    end if;
    if (task_item ->> 'estimated_minutes')::numeric < 1
       or (task_item ->> 'estimated_minutes')::numeric > 480
       or (task_item ->> 'estimated_minutes')::numeric <> trunc((task_item ->> 'estimated_minutes')::numeric) then
      raise exception using errcode = 'PT422', message = 'Invalid duration';
    end if;
    task_title := lower(regexp_replace(btrim(task_item ->> 'title'), '[[:space:]]+', '', 'g'));
    if task_title = any(seen_titles) then
      raise exception using errcode = 'PT422', message = 'Duplicate task';
    end if;
    seen_titles := array_append(seen_titles, task_title);
  end loop;
  target_date := today_date + 1;
  insert into public.daily_plans (id, user_id, plan_date, main_goal)
  values (p_plan_id, owner_id, target_date, btrim(p_proposal ->> 'tomorrow_main_goal'))
  on conflict (user_id, plan_date) do nothing returning id into saved_id;
  if saved_id is null then
    select id into saved_id from public.daily_plans where user_id = owner_id and plan_date = target_date;
    if saved_id = p_plan_id then
      return saved_id; -- Safe retry after a committed transaction's response was lost.
    end if;
    raise exception using errcode = 'PT409', message = 'Tomorrow plan already exists';
  end if;
  for task_item in select value from jsonb_array_elements(p_proposal -> 'tasks') loop
    insert into public.tasks (user_id, daily_plan_id, title, completed, estimated_minutes, sort_order, reason, success_criteria)
    values (owner_id, saved_id, btrim(task_item ->> 'title'), false,
      (task_item ->> 'estimated_minutes')::integer, task_index,
      btrim(task_item ->> 'reason'), btrim(task_item ->> 'success_criteria'));
    task_index := task_index + 1;
  end loop;
  return saved_id;
end;
$$;
revoke all on function public.adopt_tomorrow_plan(date, jsonb, uuid) from public, anon;
grant execute on function public.adopt_tomorrow_plan(date, jsonb, uuid) to authenticated;
commit;
