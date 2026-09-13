import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const task = { title: "整理三条阅读笔记", estimated_minutes: 20, reason: "推进目标", success_criteria: "写下三条可应用的笔记" };
const proposal = { today_summary: "完成了阅读", adjustment_reason: "保持轻量", tomorrow_main_goal: "整理阅读收获", tasks: [task, { ...task, title: "散步十五分钟", estimated_minutes: 15 }] };
test("AI adoption is atomic, idempotent, RLS-scoped and never overwrites an existing plan", async () => {
  const db = new PGlite();
  const a = randomUUID(), b = randomUUID();
  try {
    await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      insert into auth.users values ('${a}'), ('${b}');`);
    for (const name of ["001_initial_schema.sql", "002_ai_tomorrow_plan.sql"]) await db.exec(await readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8"));
    const settings = (await db.query("select prosecdef, proconfig from pg_proc where proname = 'adopt_tomorrow_plan'")).rows[0];
    assert.equal(settings.prosecdef, false);
    assert.ok(settings.proconfig.some(value => value.startsWith("search_path=")));
    const today = (await db.query("select to_char((now() at time zone 'Asia/Shanghai')::date, 'YYYY-MM-DD') as day")).rows[0].day;
    const tomorrow = (await db.query("select to_char((now() at time zone 'Asia/Shanghai')::date + 1, 'YYYY-MM-DD') as day")).rows[0].day;
    const call = (id, data = proposal, date = today) => db.query("select public.adopt_tomorrow_plan($1::date, $2::jsonb, $3::uuid) as id", [date, JSON.stringify(data), id]);
    const login = async id => { await db.exec("reset role; set role authenticated;"); await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]); };
    await db.exec("set role anon;");
    await assert.rejects(call(randomUUID()), error => error.code === "42501");
    await login("");
    await assert.rejects(call(randomUUID()), error => error.code === "PT401");
    await login(a);
    await assert.rejects(call(randomUUID(), proposal, "2000-01-01"), error => error.code === "PT410");
    for (const invalid of [null, [], { ...proposal, extra: "forbidden" }, { ...proposal, tasks: "wrong" }, { ...proposal, tasks: [task, task] }, { ...proposal, tasks: Array.from({ length: 4 }, (_, i) => ({ ...task, title: String(i) })) }, { ...proposal, tasks: [{ ...task, estimated_minutes: 1.5 }] }, { ...proposal, tasks: [{ ...task, success_criteria: "" }] }]) await assert.rejects(call(randomUUID(), invalid), error => error.code === "PT422");
    assert.equal((await db.query("select * from public.daily_plans")).rows.length, 0);
    // Force a failure after inserting the plan and first task; the whole RPC must roll back.
    await db.exec("reset role;");
    await db.exec(`create function public.fail_second_task() returns trigger language plpgsql as $$ begin if new.sort_order = 1 then raise exception 'simulated write failure'; end if; return new; end; $$;
      create trigger fail_second_task before insert on public.tasks for each row execute function public.fail_second_task();`);
    await login(a);
    await assert.rejects(call(randomUUID()), /simulated write failure/);
    assert.equal((await db.query("select * from public.daily_plans")).rows.length, 0);
    assert.equal((await db.query("select * from public.tasks")).rows.length, 0);
    await db.exec("reset role; drop trigger fail_second_task on public.tasks; drop function public.fail_second_task();");
    await login(a);
    const id = randomUUID();
    assert.equal((await call(id)).rows[0].id, id);
    // Two repeated confirmations using the same request ID create no extra tasks.
    const retries = await Promise.all([call(id), call(id)]);
    assert.ok(retries.every(result => result.rows[0].id === id));
    assert.equal((await db.query("select * from public.daily_plans")).rows.length, 1);
    const savedTasks = (await db.query("select * from public.tasks order by sort_order")).rows;
    assert.equal(savedTasks.length, 2); assert.ok(savedTasks.every(row => row.user_id === a && row.daily_plan_id === id && row.completed === false));
    assert.equal(savedTasks[0].success_criteria, task.success_criteria);
    await assert.rejects(call(randomUUID(), { ...proposal, tomorrow_main_goal: "不应覆盖" }), error => error.code === "PT409");
    const savedPlan = (await db.query("select * from public.daily_plans")).rows[0];
    assert.equal(new Date(savedPlan.plan_date).toISOString().slice(0, 10), tomorrow); assert.equal(savedPlan.main_goal, proposal.tomorrow_main_goal);
    await login(b);
    assert.equal((await db.query("select * from public.daily_plans")).rows.length, 0);
    const bId = randomUUID();
    assert.equal((await call(bId, { ...proposal, tasks: [] })).rows[0].id, bId);
    assert.equal((await db.query("select * from public.tasks")).rows.length, 0);
    // Tomorrow's automatic empty plan from another device also blocks adoption.
    await db.query("delete from public.daily_plans where id = $1", [bId]);
    await db.query("insert into public.daily_plans(user_id,plan_date) values ($1,$2::date)", [b, tomorrow]);
    await assert.rejects(call(randomUUID()), error => error.code === "PT409");
  } finally { await db.close(); }
});
