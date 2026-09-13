-- Execute once after 001 and 002. No existing records are deleted.
begin;
create table public.chat_sessions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 title text not null default '新的对话' check(char_length(title) between 1 and 120), archived boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
create table public.chat_messages (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null, role text not null check(role in ('user','assistant')),
 content text not null check(char_length(content) between 1 and 8000),
 metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=131072),
 created_at timestamptz not null default now(), unique(id,user_id),
 foreign key(session_id,user_id) references public.chat_sessions(id,user_id) on delete cascade
);
create unique index chat_one_reply on public.chat_messages(user_id,(metadata->>'reply_to')) where role='assistant' and metadata ? 'reply_to';
create index chat_messages_session_date on public.chat_messages(user_id,session_id,created_at desc,id);
create index chat_sessions_owner on public.chat_sessions(user_id,updated_at desc);
create table public.memories (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 category text not null check(char_length(category) between 1 and 80), key text not null check(char_length(key) between 1 and 120),
 value text not null check(char_length(btrim(value)) between 1 and 1200),
 status text not null default 'proposed' check(status in ('proposed','active','superseded','invalidated')),
 confidence text not null check(confidence in ('low','medium','high')),
 source_message_id uuid, supersedes_memory_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id),
 foreign key(source_message_id,user_id) references public.chat_messages(id,user_id) on delete set null (source_message_id),
 foreign key(supersedes_memory_id,user_id) references public.memories(id,user_id) on delete set null (supersedes_memory_id)
);
create unique index memories_one_active on public.memories(user_id,category,key) where status='active';
create index memories_owner_status on public.memories(user_id,status,updated_at desc);
create table public.period_summaries (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 period_start date not null, period_end date not null, summary text not null check(char_length(btrim(summary)) between 1 and 12000),
 created_at timestamptz not null default now(), check(period_end>=period_start), unique(user_id,period_start,period_end)
);
create index period_summaries_owner on public.period_summaries(user_id,period_end desc);
do $$ declare t text; begin
 foreach t in array array['chat_sessions','chat_messages','memories','period_summaries'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('create policy own_select on public.%I for select to authenticated using ((select auth.uid())=user_id)',t);
  execute format('create policy own_insert on public.%I for insert to authenticated with check ((select auth.uid())=user_id)',t);
  execute format('create policy own_update on public.%I for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
  execute format('create policy own_delete on public.%I for delete to authenticated using ((select auth.uid())=user_id)',t);
 end loop;
end $$;
create function public.butler_touch() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=clock_timestamp(); return new; end $$;
create trigger chat_sessions_touch before update on public.chat_sessions for each row execute function public.butler_touch();
create trigger memories_touch before update on public.memories for each row execute function public.butler_touch();

-- Explicit user confirmation/edit only. The AI handler never calls this RPC.
-- Expected predecessor and a per-key lock prevent stale confirmations and competing active values.
create function public.confirm_memory(p_id uuid,p_category text,p_key text,p_value text,p_confidence text,p_source uuid,p_previous uuid,p_action text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); old_id uuid; begin
 if owner_id is null then raise exception using errcode='PT401',message='Login required'; end if;
 if p_action not in ('replace','invalidate') or p_action is null then raise exception using errcode='PT422',message='Invalid action'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':'||p_category||':'||p_key,0));
 if exists(select 1 from public.memories where id=p_id and user_id=owner_id) then return p_id; end if;
 select id into old_id from public.memories where user_id=owner_id and category=p_category and key=p_key and status='active' for update;
 if old_id is distinct from p_previous then raise exception using errcode='PT409',message='Memory changed; refresh'; end if;
 if p_action='invalidate' and old_id is null then raise exception using errcode='PT409',message='No active memory'; end if;
 update public.memories set status=case when p_action='invalidate' then 'invalidated' else 'superseded' end where id=old_id and user_id=owner_id;
 insert into public.memories(id,user_id,category,key,value,status,confidence,source_message_id,supersedes_memory_id)
 values(p_id,owner_id,p_category,p_key,p_value,case when p_action='invalidate' then 'invalidated' else 'active' end,p_confidence,p_source,old_id);
 return p_id;
end $$;
revoke all on function public.confirm_memory(uuid,text,text,text,text,uuid,uuid,text) from public,anon;
grant execute on function public.confirm_memory(uuid,text,text,text,text,uuid,uuid,text) to authenticated;

-- Claims a user turn without holding a database transaction across an AI network call.
create function public.claim_chat_turn(p_id uuid,p_session uuid,p_content text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare existing public.chat_messages; begin
 if auth.uid() is null then raise exception using errcode='PT401',message='Login required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into existing from public.chat_messages where id=p_id and user_id=auth.uid() for update;
 if found then
  if existing.session_id<>p_session or existing.content<>p_content or existing.role<>'user' then raise exception using errcode='PT409',message='Turn changed'; end if;
  if existing.metadata->>'state'='done' then return false; end if;
  if existing.metadata->>'state'='processing' and (existing.metadata->>'started_at')::timestamptz>now()-interval '3 minutes' then raise exception using errcode='PT409',message='Turn processing'; end if;
  update public.chat_messages set metadata=jsonb_build_object('state','processing','started_at',now()) where id=p_id and user_id=auth.uid();
 else
  insert into public.chat_messages(id,user_id,session_id,role,content,metadata) values(p_id,auth.uid(),p_session,'user',p_content,jsonb_build_object('state','processing','started_at',now()));
 end if;
 return true;
end $$;
revoke all on function public.claim_chat_turn(uuid,uuid,text) from public,anon;
grant execute on function public.claim_chat_turn(uuid,uuid,text) to authenticated;
commit;
