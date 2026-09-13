-- Run once after 003. Private, dated course entries; no production data is embedded.
begin;
create table public.course_schedule (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 course_date date not null, title text not null check(char_length(btrim(title)) between 1 and 160),
 period_start smallint not null check(period_start between 1 and 14), period_end smallint not null check(period_end between period_start and 14),
 location text not null default '' check(char_length(location)<=160),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,course_date,title,period_start,period_end)
);
create index course_schedule_owner_date on public.course_schedule(user_id,course_date,period_start);
create function public.valid_schedule_periods(value jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare item jsonb; seen integer[]:=array[]::integer[]; p integer; begin
 if jsonb_typeof(value) is distinct from 'array' then return false; end if;
 if jsonb_array_length(value)>14 then return false; end if;
 for item in select v from jsonb_array_elements(value) as a(v) loop
  if jsonb_typeof(item) is distinct from 'object' then return false; end if;
  if not(item ?& array['period','start','end']) or (select count(*) from jsonb_object_keys(item))<>3 then return false; end if;
  if jsonb_typeof(item->'period') is distinct from 'number' or (item->>'period')!~'^(1[0-4]|[1-9])$' then return false; end if;
  p:=(item->>'period')::integer;
  if p=any(seen) then return false; end if; seen:=array_append(seen,p);
  if jsonb_typeof(item->'start') is distinct from 'string' or jsonb_typeof(item->'end') is distinct from 'string' then return false; end if;
  if (item->>'start')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or (item->>'end')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or (item->>'start')>=(item->>'end') then return false; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(valid_schedule_periods.value) a cross join jsonb_array_elements(valid_schedule_periods.value) b where (a->>'period')::integer < (b->>'period')::integer and a->>'end'>b->>'start') then return false; end if;
 return true;
end $$;
create table public.schedule_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 period_times jsonb not null default '[]' check(public.valid_schedule_periods(period_times)),
 updated_at timestamptz not null default now()
);
do $$ declare t text; begin
 foreach t in array array['course_schedule','schedule_settings'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('create policy own_select on public.%I for select to authenticated using ((select auth.uid())=user_id)',t);
  execute format('create policy own_insert on public.%I for insert to authenticated with check ((select auth.uid())=user_id)',t);
  execute format('create policy own_update on public.%I for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
  execute format('create policy own_delete on public.%I for delete to authenticated using ((select auth.uid())=user_id)',t);
  execute format('create trigger touch before update on public.%I for each row execute function public.butler_touch()',t);
 end loop;
end $$;
-- One transaction for the entire reviewed import. Duplicate entries do not overwrite edits.
create function public.import_course_schedule(p_entries jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare entry jsonb; inserted integer; total integer:=0; begin
 if auth.uid() is null then raise exception using errcode='PT401',message='Login required'; end if;
 if jsonb_typeof(p_entries) is distinct from 'array' then raise exception using errcode='PT422',message='Invalid import'; end if;
 if jsonb_array_length(p_entries) not between 1 and 1000 then raise exception using errcode='PT422',message='Import size'; end if;
 for entry in select value from jsonb_array_elements(p_entries) loop
  if jsonb_typeof(entry) is distinct from 'object' then raise exception using errcode='PT422',message='Invalid entry'; end if;
  if not(entry ?& array['course_date','title','period_start','period_end','location']) or (select count(*) from jsonb_object_keys(entry))<>5 then raise exception using errcode='PT422',message='Invalid fields'; end if;
  if jsonb_typeof(entry->'title') is distinct from 'string' or jsonb_typeof(entry->'location') is distinct from 'string' or jsonb_typeof(entry->'course_date') is distinct from 'string' or (entry->>'course_date')!~'^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(entry->'period_start') is distinct from 'number' or jsonb_typeof(entry->'period_end') is distinct from 'number' then raise exception using errcode='PT422',message='Invalid types'; end if;
  insert into public.course_schedule(user_id,course_date,title,period_start,period_end,location)
  values(auth.uid(),(entry->>'course_date')::date,btrim(entry->>'title'),(entry->>'period_start')::smallint,(entry->>'period_end')::smallint,btrim(entry->>'location'))
  on conflict(user_id,course_date,title,period_start,period_end) do nothing;
  get diagnostics inserted = row_count; total:=total+inserted;
 end loop;
 return total;
end $$;
revoke all on function public.import_course_schedule(jsonb) from public,anon;
grant execute on function public.import_course_schedule(jsonb) to authenticated;
commit;
