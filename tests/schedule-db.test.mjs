import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('schedule import is atomic, duplicate safe and private; clock settings validate and obey RLS',async()=>{
 const db=new PGlite(),a=uuid(),b=uuid();
 try{
 await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid'; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; insert into auth.users values('${a}'),('${b}');`);
 for(const f of ['001_initial_schema.sql','002_ai_tomorrow_plan.sql','003_butler_chat_memory.sql','004_course_schedule.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
 const login=async user=>{await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);};
 const entry={course_date:'2026-09-14',title:'测试课程',period_start:1,period_end:2,location:'测试教室'};
 const load=entries=>db.query('select import_course_schedule($1::jsonb) as count',[JSON.stringify(entries)]);
 await login(a);assert.equal((await load([entry])).rows[0].count,1);assert.equal((await load([entry])).rows[0].count,0);
 await assert.rejects(load([{...entry,title:'必须回滚'},{...entry,title:'无效节次',period_start:0}]));
 assert.equal((await db.query('select * from course_schedule')).rows.length,1);
 await assert.rejects(load([{...entry,user_id:b}]),e=>e.code==='PT422');
 await assert.rejects(load([{...entry,course_date:'2026-02-30'}]));
 const row=(await db.query('select * from course_schedule')).rows[0];
 await db.query('insert into schedule_settings(user_id,period_times) values($1,$2)',[a,JSON.stringify([{period:1,start:'08:00',end:'08:45'},{period:2,start:'08:55',end:'09:40'}])]);
 for(const times of [[{period:1,start:'09:00',end:'08:00'}],[{period:1,start:'28:00',end:'29:00'}],[{period:1,start:'08:00',end:'09:00'},{period:2,start:'08:50',end:'09:40'}],[{period:1,start:'08:00',end:'09:00'},{period:1,start:'10:00',end:'11:00'}]])await assert.rejects(db.query('update schedule_settings set period_times=$1',[JSON.stringify(times)]),e=>e.code==='23514');
 await login(b);
 for(const table of ['course_schedule','schedule_settings']){assert.equal((await db.query(`select * from ${table}`)).rows.length,0);assert.equal((await db.query(`delete from ${table} where user_id=$1 returning user_id`,[a])).rows.length,0);}
 assert.equal((await db.query("update course_schedule set title='入侵' where id=$1 returning id",[row.id])).rows.length,0);
 await assert.rejects(db.query('insert into schedule_settings(user_id) values($1)',[a]),e=>e.code==='42501');
 assert.equal((await load([entry])).rows[0].count,1);
 await assert.rejects(db.query('update course_schedule set user_id=$1',[a]),e=>e.code==='42501');
 await db.exec('reset role;set role anon');await assert.rejects(load([entry]),e=>e.code==='42501');await assert.rejects(db.query('select * from course_schedule'),e=>e.code==='42501');
 }finally{await db.close();}
});
