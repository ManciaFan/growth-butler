import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID as uuid } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("today revision is atomic, private, stale-safe, idempotent and preserves completed/past tasks", async () => {
  const db = new PGlite(),
    a = uuid(),
    b = uuid(),
    pid = uuid(),
    session = uuid(),
    done = uuid(),
    past = uuid(),
    future = uuid();
  try {
    await db.exec(
      `create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;insert into auth.users values('${a}'),('${b}');`,
    );
    for (const f of [
      "001_initial_schema.sql",
      "002_ai_tomorrow_plan.sql",
      "003_butler_chat_memory.sql",
      "004_course_schedule.sql",
      "005_today_replanning.sql",
    ])
      await db.exec(
        await readFile(
          new URL("../supabase/migrations/" + f, import.meta.url),
          "utf8",
        ),
      );
    await db.exec(
      `create or replace function public.replanning_now() returns timestamptz language sql volatile security invoker set search_path=public as $$select '2026-09-14T16:00:00+08:00'::timestamptz$$;`,
    );
    const login = async (u) => {
      await db.exec("reset role;set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        u,
      ]);
    };
    await login(a);
    await db.query(
      "insert into daily_plans(id,user_id,plan_date,main_goal) values($1,$2,'2026-09-14','保留主目标')",
      [pid, a],
    );
    await db.query("insert into chat_sessions(id,user_id) values($1,$2)", [
      session,
      a,
    ]);
    await db.query(
      "insert into tasks(id,user_id,daily_plan_id,title,completed,scheduled_start,scheduled_end) values($1,$4,$5,'已完成',true,null,null),($2,$4,$5,'已经开始',false,'2026-09-14T15:55:00+08:00','2026-09-14T16:20:00+08:00'),($3,$4,$5,'旧任务',false,null,null)",
      [done, past, future, a, pid],
    );
    const protectedBefore = (
      await db.query("select * from tasks where id in ($1,$2) order by id", [
        done,
        past,
      ])
    ).rows;
    const task = {
      source_task_id: future,
      title: "新安排",
      start_time: "17:00",
      end_time: "17:30",
      estimated_minutes: 30,
      reason: "缩小范围",
      success_criteria: "写完提纲",
    };
    const snapshot = async () =>
      (await db.query("select get_today_replanning_snapshot() as s")).rows[0].s;
    const preview = async (tasks = [task], overrides = {}) => {
      const id = uuid();
      await db.query(
        "insert into chat_messages(id,user_id,session_id,role,content,metadata) values($1,$2,$3,'assistant','预览',$4)",
        [
          id,
          a,
          session,
          JSON.stringify({
            today_snapshot: await snapshot(),
            today_generated_at: "2026-09-14T15:59:00+08:00",
            result: { today_revision: { reason: "临时有事，减少任务", tasks } },
            ...overrides,
          }),
        ],
      );
      return id;
    };
    const apply = (id) =>
      db.query("select apply_today_revision($1) as id", [id]);
    for (const bad of [
      { ...task, source_task_id: done },
      { ...task, source_task_id: past },
      { ...task, start_time: "15:00", end_time: "15:30" },
      { ...task, start_time: "16:10", end_time: "16:40" },
      { ...task, title: "已完成" },
      { ...task, estimated_minutes: 25 },
    ])
      await assert.rejects(apply(await preview([bad])));
    const stale = await preview();
    await db.query("update tasks set title='其他设备改动' where id=$1", [
      future,
    ]);
    await assert.rejects(apply(stale), (e) => e.code === "PT409");
    const completedPreview = await preview();
    await db.query("update tasks set completed=true where id=$1", [future]);
    await assert.rejects(apply(completedPreview), (e) => e.code === "PT409");
    await db.query("update tasks set completed=false where id=$1", [future]);
    const id = await preview();
    assert.equal((await apply(id)).rows[0].id, id);
    await apply(id);
    assert.deepEqual(
      (
        await db.query("select * from tasks where id in ($1,$2) order by id", [
          done,
          past,
        ])
      ).rows,
      protectedBefore,
    );
    assert.equal((await db.query("select * from tasks")).rows.length, 3);
    assert.equal(
      (await db.query("select * from today_plan_revisions")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select main_goal from daily_plans")).rows[0].main_goal,
      "保留主目标",
    );
    // Whole transaction rolls back when the second proposed task is invalid.
    const before = await snapshot();
    await assert.rejects(
      apply(
        await preview([
          task,
          {
            ...task,
            source_task_id: null,
            title: "第二项",
            start_time: "17:15",
            end_time: "17:45",
          },
        ]),
      ),
    );
    assert.deepEqual(await snapshot(), before);
    await assert.rejects(
      apply(
        await preview([task], {
          today_generated_at: "2026-09-14T15:00:00+08:00",
        }),
      ),
      (e) => e.code === "PT410",
    );
    const old = await preview();
    await db.query(
      "insert into memories(user_id,category,key,value,status,confidence) values($1,'作息','sleep','睡眠23:00–07:00','active','high')",
      [a],
    );
    await assert.rejects(apply(old), (e) => e.code === "PT409");
    await assert.rejects(
      apply(
        await preview([{ ...task, start_time: "23:10", end_time: "23:40" }]),
      ),
      (e) => e.code === "PT422",
    );
    await db.query(
      "insert into course_schedule(user_id,course_date,title,period_start,period_end,location) values($1,'2026-09-14','课程',9,10,'A')",
      [a],
    );
    await assert.rejects(
      apply(
        await preview([{ ...task, start_time: "18:10", end_time: "18:40" }]),
      ),
      (e) => e.code === "PT422",
    );
    const removal = await preview([]);
    await apply(removal);
    assert.equal((await db.query("select * from tasks")).rows.length, 2);
    assert.deepEqual(
      (await db.query("select * from tasks order by id")).rows,
      protectedBefore,
    );
    await login(b);
    assert.equal(
      (await db.query("select * from today_plan_revisions")).rows.length,
      0,
    );
    assert.equal((await snapshot()).plan, null);
    await assert.rejects(apply(id), (e) => e.code === "PT422");
    await assert.rejects(
      db.query(
        "insert into today_plan_revisions select $1,$2,$3,current_date,'hack',now(),now(),'[]','[]'",
        [uuid(), a, pid],
      ),
      (e) => e.code === "42501",
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(apply(id), (e) => e.code === "42501");
  } finally {
    await db.close();
  }
});
