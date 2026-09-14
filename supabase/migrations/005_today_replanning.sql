begin;
alter table public.tasks add column scheduled_start timestamptz, add column scheduled_end timestamptz;
alter table public.tasks add constraint tasks_schedule_check check ((scheduled_start is null and scheduled_end is null) or (scheduled_start is not null and scheduled_end is not null and scheduled_end > scheduled_start));
create table public.today_plan_revisions (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 daily_plan_id uuid not null, revision_date date not null, reason text not null check(length(reason) between 1 and 1600),
 generated_at timestamptz not null, applied_at timestamptz not null default clock_timestamp(),
 before_tasks jsonb not null, after_tasks jsonb not null,
 foreign key(daily_plan_id,user_id) references public.daily_plans(id,user_id) on delete cascade
);
create index today_revisions_user_date on public.today_plan_revisions(user_id,revision_date,applied_at);
alter table public.today_plan_revisions enable row level security;
alter table public.today_plan_revisions force row level security;
create policy own_select on public.today_plan_revisions for select to authenticated using(auth.uid()=user_id);
create policy own_insert on public.today_plan_revisions for insert to authenticated with check(auth.uid()=user_id);
create policy own_update on public.today_plan_revisions for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy own_delete on public.today_plan_revisions for delete to authenticated using(auth.uid()=user_id);
revoke all on public.today_plan_revisions from anon;
grant select,insert,update,delete on public.today_plan_revisions to authenticated;

-- Isolated clock makes boundary tests deterministic; callers cannot supply a clock.
create function public.replanning_now() returns timestamptz language sql volatile security invoker set search_path=public as $$select clock_timestamp()$$;
-- Every authenticated write affecting a preview takes the same per-user lock,
-- including inserts (row locks alone cannot protect against phantom rows).
create function public.lock_replanning_context() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if auth.uid() is not null then perform pg_advisory_xact_lock(hashtextextended('today-context:'||auth.uid()::text,0)); end if;
 return null;
end $$;
do $$declare t text; begin
 foreach t in array array['daily_plans','tasks','course_schedule','schedule_settings','memories','goals','daily_feedback'] loop
  execute format('create trigger serialize_today_context before insert or update or delete on public.%I for each statement execute function public.lock_replanning_context()',t);
 end loop;
end $$;
create function public.get_today_replanning_snapshot() returns jsonb language plpgsql volatile security invoker set search_path=public as $$
declare u uuid:=auth.uid(); d date:=(public.replanning_now() at time zone 'Asia/Shanghai')::date;
 p jsonb; ts jsonb; cs jsonb; ms jsonb; gs jsonb; ss jsonb; fb jsonb; blocks jsonb:='[]'; periods jsonb;
 c jsonb; m jsonb; matches text[]; a integer; b integer; unknown_count integer:=0;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHENTICATED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('today-context:'||u::text,0));
 select to_jsonb(x)-'user_id' into p from public.daily_plans x where user_id=u and plan_date=d;
 select coalesce(jsonb_agg(to_jsonb(x)-'user_id' order by id),'[]') into ts from public.tasks x where user_id=u and daily_plan_id=(p->>'id')::uuid;
 select coalesce(jsonb_agg(to_jsonb(x)-'user_id' order by id),'[]') into cs from public.course_schedule x where user_id=u and course_date=d;
 select coalesce(jsonb_agg(to_jsonb(x)-'user_id' order by id),'[]') into ms from public.memories x where user_id=u and status='active';
 select coalesce(jsonb_agg(to_jsonb(x)-'user_id' order by id),'[]') into gs from public.goals x where user_id=u and status='active';
 select to_jsonb(x)-'user_id' into ss from public.schedule_settings x where user_id=u;
 select to_jsonb(x)-'user_id' into fb from public.daily_feedback x where user_id=u and feedback_date=d;
 periods:=coalesce(ss->'period_times','[{"period":1,"start":"08:00","end":"08:45"},{"period":2,"start":"08:50","end":"09:35"},{"period":3,"start":"09:55","end":"10:40"},{"period":4,"start":"10:45","end":"11:30"},{"period":5,"start":"13:30","end":"14:15"},{"period":6,"start":"14:20","end":"15:05"},{"period":7,"start":"15:25","end":"16:10"},{"period":8,"start":"16:15","end":"17:00"},{"period":9,"start":"18:00","end":"18:45"},{"period":10,"start":"18:50","end":"19:35"},{"period":11,"start":"19:55","end":"20:30"},{"period":12,"start":"20:35","end":"21:30"}]'::jsonb);
 for c in select value from jsonb_array_elements(cs) loop
  select extract(epoch from (value->>'start')::time)::integer/60 into a from jsonb_array_elements(periods) where (value->>'period')::integer=(c->>'period_start')::integer;
  select extract(epoch from (value->>'end')::time)::integer/60 into b from jsonb_array_elements(periods) where (value->>'period')::integer=(c->>'period_end')::integer;
  if a is null or b is null then unknown_count:=unknown_count+1; else blocks:=blocks||jsonb_build_array(jsonb_build_object('title',c->>'title','start',a,'end',b)); end if;
 end loop;
 -- Explicit clock ranges in confirmed rules are fixed; free-form duration rules remain AI context.
 for m in select value from jsonb_array_elements(ms) loop
  for matches in select regexp_matches(replace(m->>'value','：',':'),'([0-2]?[0-9]):([0-5][0-9])[[:space:]]*[-–—~～至到][[:space:]]*(?:次日)?([0-2]?[0-9]):([0-5][0-9])','g') loop
   a:=matches[1]::integer*60+matches[2]::integer; b:=matches[3]::integer*60+matches[4]::integer;
   if a<1440 and b<1440 then
    if b>a then blocks:=blocks||jsonb_build_array(jsonb_build_object('title',m->>'value','start',a,'end',b));
    else blocks:=blocks||jsonb_build_array(jsonb_build_object('title',m->>'value','start',a,'end',1440),jsonb_build_object('title',m->>'value','start',0,'end',b)); end if;
   end if;
  end loop;
 end loop;
 return jsonb_build_object('date',d,'plan',p,'tasks',ts,'courses',cs,'memories',ms,'goals',gs,'settings',ss,'feedback',fb,'fixed_blocks',blocks,'unknown_courses',unknown_count);
end $$;

create function public.apply_today_revision(p_message_id uuid) returns uuid language plpgsql security invoker set search_path=public as $$
declare u uuid:=auth.uid(); meta jsonb; snap jsonb; current_snap jsonb; proposal jsonb; item jsonb; block jsonb;
 pid uuid; d date; generated timestamptz; now_at timestamptz; start_at timestamptz; end_at timestamptz;
 source uuid; task_ids uuid[]:='{}'; titles text[]:='{}'; title_key text; ranges tstzrange[]:='{}'; occupied tstzrange;
 ordinal integer:=0; prior jsonb;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHENTICATED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('today-context:'||u::text,0));
 -- Serialize retries, including retries after a lost successful response.
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_message_id::text,0));
 if exists(select 1 from public.today_plan_revisions where id=p_message_id and user_id=u) then return p_message_id; end if;
 select metadata into meta from public.chat_messages where id=p_message_id and user_id=u and role='assistant' for update;
 if meta is null then raise sqlstate 'PT422' using message='INVALID_REVISION'; end if;
 snap:=meta->'today_snapshot'; proposal:=meta->'result'->'today_revision'; generated:=(meta->>'today_generated_at')::timestamptz;
 now_at:=public.replanning_now(); d:=(now_at at time zone 'Asia/Shanghai')::date;
 if snap is null or proposal is null or proposal='null'::jsonb or generated is null then raise sqlstate 'PT422' using message='INVALID_REVISION'; end if;
 if snap->>'date'<>d::text or generated>now_at or now_at-generated>interval '30 minutes' then raise sqlstate 'PT410' using message='REVISION_EXPIRED'; end if;
 pid:=(snap->'plan'->>'id')::uuid;
 perform 1 from public.daily_plans where id=pid and user_id=u and plan_date=d for update;
 if not found then raise sqlstate 'PT409' using message='PLAN_CHANGED'; end if;
 perform 1 from public.tasks where user_id=u and daily_plan_id=pid order by id for update;
 -- The user-level lock already protects constraint writes, including new rows.
 -- Avoid memory row locks: confirm_memory acquires its row before its write
 -- trigger, so taking another row lock here would invert that lock order.
 current_snap:=public.get_today_replanning_snapshot();
 if current_snap is distinct from snap then raise sqlstate 'PT409' using message='PLAN_CHANGED'; end if;
 if (snap->>'unknown_courses')::integer>0 then raise sqlstate 'PT422' using message='COURSE_TIME_MISSING'; end if;
 if jsonb_typeof(proposal)<>'object' or (select array_agg(key order by key) from jsonb_object_keys(proposal) key)<>array['reason','tasks'] or jsonb_typeof(proposal->'reason')<>'string' or length(btrim(proposal->>'reason')) not between 1 and 1600 or jsonb_typeof(proposal->'tasks')<>'array' or jsonb_array_length(proposal->'tasks')>6 then raise sqlstate 'PT422' using message='INVALID_REVISION'; end if;
 for block in select value from jsonb_array_elements(snap->'fixed_blocks') loop
  ranges:=array_append(ranges,tstzrange((d::timestamp at time zone 'Asia/Shanghai')+make_interval(mins=>(block->>'start')::integer),(d::timestamp at time zone 'Asia/Shanghai')+make_interval(mins=>(block->>'end')::integer),'[)'));
 end loop;
 for item in select to_jsonb(t) from public.tasks t where user_id=u and daily_plan_id=pid and (completed or scheduled_start<=now_at) loop
  titles:=array_append(titles,lower(regexp_replace(normalize(item->>'title',NFKC),'\s','','g')));
  if item->>'scheduled_start' is not null then ranges:=array_append(ranges,tstzrange((item->>'scheduled_start')::timestamptz,(item->>'scheduled_end')::timestamptz,'[)')); end if;
 end loop;
 prior:=snap->'tasks';
 for item in select value from jsonb_array_elements(proposal->'tasks') loop
  if jsonb_typeof(item)<>'object' or (select array_agg(key order by key) from jsonb_object_keys(item) key)<>array['end_time','estimated_minutes','reason','source_task_id','start_time','success_criteria','title'] then raise sqlstate 'PT422' using message='INVALID_TASK'; end if;
  if jsonb_typeof(item->'title')<>'string' or length(btrim(item->>'title')) not between 1 and 200 or jsonb_typeof(item->'reason')<>'string' or length(btrim(item->>'reason')) not between 1 and 1000 or jsonb_typeof(item->'success_criteria')<>'string' or length(btrim(item->>'success_criteria')) not between 1 and 1000 or coalesce(item->>'start_time','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(item->>'end_time','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or jsonb_typeof(item->'estimated_minutes')<>'number' then raise sqlstate 'PT422' using message='INVALID_TASK'; end if;
  start_at:=(d::text||' '||(item->>'start_time'))::timestamp at time zone 'Asia/Shanghai'; end_at:=(d::text||' '||(item->>'end_time'))::timestamp at time zone 'Asia/Shanghai';
  if start_at<=public.replanning_now() then raise sqlstate 'PT410' using message='REVISION_EXPIRED'; end if;
  if end_at<=start_at or extract(epoch from end_at-start_at)/60<>(item->>'estimated_minutes')::numeric then raise sqlstate 'PT422' using message='INVALID_DURATION'; end if;
  occupied:=tstzrange(start_at,end_at,'[)');
  if exists(select 1 from unnest(ranges) r where r&&occupied) then raise sqlstate 'PT422' using message='OCCUPIED_TIME'; end if;
  ranges:=array_append(ranges,occupied); title_key:=lower(regexp_replace(normalize(item->>'title',NFKC),'\s','','g'));
  if title_key=any(titles) then raise sqlstate 'PT422' using message='DUPLICATE_TASK'; end if; titles:=array_append(titles,title_key);
  source:=(item->>'source_task_id')::uuid;
  if source is not null then
   if source=any(task_ids) or not exists(select 1 from public.tasks where id=source and user_id=u and daily_plan_id=pid and not completed and (scheduled_start is null or scheduled_start>now_at)) then raise sqlstate 'PT409' using message='PROTECTED_TASK'; end if;
  else source:=gen_random_uuid(); end if;
  task_ids:=array_append(task_ids,source); ordinal:=ordinal+1;
  insert into public.tasks(id,user_id,daily_plan_id,title,estimated_minutes,sort_order,reason,success_criteria,scheduled_start,scheduled_end)
   values(source,u,pid,btrim(item->>'title'),(item->>'estimated_minutes')::integer,1000+ordinal,item->>'reason',item->>'success_criteria',start_at,end_at)
   on conflict(id) do update set title=excluded.title,estimated_minutes=excluded.estimated_minutes,sort_order=excluded.sort_order,reason=excluded.reason,success_criteria=excluded.success_criteria,scheduled_start=excluded.scheduled_start,scheduled_end=excluded.scheduled_end;
 end loop;
 delete from public.tasks where user_id=u and daily_plan_id=pid and not completed and (scheduled_start is null or scheduled_start>now_at) and not(id=any(task_ids));
 update public.daily_plans set updated_at=clock_timestamp() where id=pid and user_id=u;
 insert into public.today_plan_revisions(id,user_id,daily_plan_id,revision_date,reason,generated_at,before_tasks,after_tasks)
 values(p_message_id,u,pid,d,proposal->>'reason',generated,prior,(select coalesce(jsonb_agg(to_jsonb(t)-'user_id' order by id),'[]') from public.tasks t where user_id=u and daily_plan_id=pid));
 update public.chat_messages set metadata=metadata||jsonb_build_object('today_applied_at',public.replanning_now()) where id=p_message_id and user_id=u;
 return p_message_id;
end $$;
revoke all on function public.lock_replanning_context(),public.replanning_now(),public.get_today_replanning_snapshot(),public.apply_today_revision(uuid) from public,anon;
grant execute on function public.lock_replanning_context(),public.replanning_now(),public.get_today_replanning_snapshot(),public.apply_today_revision(uuid) to authenticated;
commit;
