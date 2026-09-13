import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID as uuid } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("chat, memory and summaries enforce RLS, ownership, confirmation, atomic replacement and turn retries", async () => {
  const db = new PGlite(),
    a = uuid(),
    b = uuid(),
    session = uuid(),
    message = uuid();
  try {
    await db.exec(
      `create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid'; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; insert into auth.users values ('${a}'),('${b}');`,
    );
    for (const f of [
      "001_initial_schema.sql",
      "002_ai_tomorrow_plan.sql",
      "003_butler_chat_memory.sql",
    ])
      await db.exec(
        await readFile(
          new URL("../supabase/migrations/" + f, import.meta.url),
          "utf8",
        ),
      );
    const login = async (id) => {
      await db.exec("reset role; set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
    };
    const confirm = (
      id,
      previous = null,
      action = "replace",
      value = "找实习",
    ) =>
      db.query(
        "select confirm_memory($1,'career','priority',$2,'high',$3,$4,$5)",
        [id, value, message, previous, action],
      );
    await login(a);
    await db.query("insert into chat_sessions(id,user_id) values($1,$2)", [
      session,
      a,
    ]);
    const claim = () =>
      db.query("select claim_chat_turn($1,$2,$3) as claimed", [
        message,
        session,
        "以后每天可投入3小时",
      ]);
    assert.equal((await claim()).rows[0].claimed, true);
    await assert.rejects(claim(), (e) => e.code === "PT409");
    assert.equal(
      (await db.query("select * from memories")).rows.length,
      0,
      "raw chat does not become memory",
    );
    await db.query(
      "update chat_messages set metadata='{" +
        '"state":"failed"' +
        "}' where id=$1",
      [message],
    );
    assert.equal((await claim()).rows[0].claimed, true);
    assert.equal(
      (await db.query("select * from chat_messages")).rows.length,
      1,
    );
    const old = uuid(),
      next = uuid();
    await confirm(old);
    await confirm(old);
    assert.equal(
      (await db.query("select * from memories where status='active'")).rows
        .length,
      1,
    );
    await assert.rejects(
      confirm(uuid(), old, "replace", ""),
      (e) => e.code === "23514",
    );
    assert.equal(
      (await db.query("select status from memories where id=$1", [old])).rows[0]
        .status,
      "active",
      "failed replacement rolls back old status",
    );
    await confirm(next, old, "replace", "暂停旧方向，优先嵌入式实习");
    assert.equal(
      (await db.query("select status from memories where id=$1", [old])).rows[0]
        .status,
      "superseded",
    );
    await assert.rejects(confirm(uuid(), old), (e) => e.code === "PT409");
    const invalid = uuid();
    await confirm(invalid, next, "invalidate");
    assert.equal(
      (await db.query("select * from memories where status='active'")).rows
        .length,
      0,
    );
    assert.equal(
      (await db.query("select * from chat_messages")).rows.length,
      1,
      "corrections preserve chat",
    );
    await db.query(
      "insert into period_summaries(user_id,period_start,period_end,summary) values($1,'2026-08-01','2026-08-31','方向改变，旧结论已被纠正')",
      [a],
    );
    await login(b);
    for (const table of [
      "chat_sessions",
      "chat_messages",
      "memories",
      "period_summaries",
    ]) {
      assert.equal((await db.query(`select * from ${table}`)).rows.length, 0);
      assert.equal(
        (
          await db.query(`delete from ${table} where user_id=$1 returning id`, [
            a,
          ])
        ).rows.length,
        0,
      );
    }
    await assert.rejects(
      db.query(
        "insert into chat_messages(user_id,session_id,role,content) values($1,$2,'user','侵入')",
        [b, session],
      ),
      (e) => e.code === "23503",
    );
    await assert.rejects(
      db.query(
        "insert into memories(user_id,category,key,value,confidence,source_message_id) values($1,'a','b','c','high',$2)",
        [b, message],
      ),
      (e) => e.code === "23503",
    );
    await assert.rejects(
      db.query("insert into chat_sessions(user_id) values($1)", [a]),
      (e) => e.code === "42501",
    );
    await login(a);
    await assert.rejects(
      db.query("update memories set user_id=$1 where id=$2", [b, next]),
      (e) => e.code === "42501",
    );
    for (const table of [
      "chat_sessions",
      "chat_messages",
      "memories",
      "period_summaries",
    ]) {
      const r = (
        await db.query("select relrowsecurity from pg_class where relname=$1", [
          table,
        ])
      ).rows[0];
      assert.equal(r.relrowsecurity, true);
      assert.equal(
        (
          await db.query("select * from pg_policies where tablename=$1", [
            table,
          ])
        ).rows.length,
        4,
      );
    }
    await db.exec("reset role; set role anon");
    await assert.rejects(
      db.query("select * from memories"),
      (e) => e.code === "42501",
    );
    await assert.rejects(confirm(uuid()), (e) => e.code === "42501");
  } finally {
    await db.close();
  }
});
