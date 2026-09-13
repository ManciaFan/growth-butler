import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Real PostgreSQL engine in memory; only Supabase's auth schema/roles are stubbed.
test("migration enforces ownership, constraints, timestamps and cascades", async () => {
  const db = new PGlite();
  const a = "00000000-0000-4000-8000-000000000001";
  const b = "00000000-0000-4000-8000-000000000002";
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      insert into auth.users values ('${a}'), ('${b}');
    `);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/001_initial_schema.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(await readFile(new URL("../supabase/migrations/002_ai_tomorrow_plan.sql", import.meta.url), "utf8"));
    const tables = ["goals", "daily_plans", "tasks", "daily_feedback"];
    assert.equal(
      (await db.query("select * from pg_policies where schemaname = 'public'"))
        .rows.length,
      16,
    );
    const security = await db.query(
      "select relrowsecurity, relforcerowsecurity from pg_class where relname = any($1::text[])",
      [tables],
    );
    assert.equal(security.rows.length, 4);
    assert.ok(
      security.rows.every(
        (row) => row.relrowsecurity && row.relforcerowsecurity,
      ),
    );
    async function login(id) {
      await db.exec("reset role; set role authenticated;");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
        id,
      ]);
    }
    const rows = {};
    for (const user of [a, b]) {
      await login(user);
      const plan = (
        await db.query(
          "insert into public.daily_plans (user_id, plan_date, main_goal) values ($1, '2026-09-12', 'Keep existing goal') returning *",
          [user],
        )
      ).rows[0];
      rows[user] = {
        daily_plans: plan,
        goals: (
          await db.query(
            "insert into public.goals (user_id, title) values ($1, 'Read') returning *",
            [user],
          )
        ).rows[0],
        tasks: (
          await db.query(
            "insert into public.tasks (user_id, daily_plan_id, title) values ($1, $2, 'Read 20 minutes') returning *",
            [user, plan.id],
          )
        ).rows[0],
        daily_feedback: (
          await db.query(
            "insert into public.daily_feedback (user_id, feedback_date, content) values ($1, '2026-09-12', 'A good day') returning *",
            [user],
          )
        ).rows[0],
      };
    }
    await login(a);
    for (const table of tables) {
      const visible = (await db.query(`select * from public.${table}`)).rows;
      assert.equal(visible.length, 1, `${table}: only own rows visible`);
      assert.equal(visible[0].user_id, a);
      assert.equal(
        (
          await db.query(
            `update public.${table} set updated_at = now() where id = $1 returning id`,
            [rows[b][table].id],
          )
        ).rows.length,
        0,
        `${table}: cross-user UPDATE blocked`,
      );
      assert.equal(
        (
          await db.query(
            `delete from public.${table} where id = $1 returning id`,
            [rows[b][table].id],
          )
        ).rows.length,
        0,
        `${table}: cross-user DELETE blocked`,
      );
      await assert.rejects(
        db.query(`update public.${table} set user_id = $1 where id = $2`, [
          b,
          rows[a][table].id,
        ]),
        (error) => error.code === "42501",
        `${table}: cannot transfer ownership`,
      );
      const updated = (
        await db.query(
          `update public.${table} set updated_at = '2000-01-01' where id = $1 returning *`,
          [rows[a][table].id],
        )
      ).rows[0];
      assert.ok(
        new Date(updated.updated_at) > new Date("2000-01-02"),
        `${table}: server timestamp trigger`,
      );
    }
    const spoofInserts = [
      ["insert into public.goals (user_id, title) values ($1, 'Spoof')", [b]],
      [
        "insert into public.daily_plans (user_id, plan_date) values ($1, '2026-09-13')",
        [b],
      ],
      [
        "insert into public.tasks (user_id, daily_plan_id, title) values ($1, $2, 'Spoof')",
        [b, rows[b].daily_plans.id],
      ],
      [
        "insert into public.daily_feedback (user_id, feedback_date) values ($1, '2026-09-13')",
        [b],
      ],
    ];
    for (const [sql, values] of spoofInserts)
      await assert.rejects(
        db.query(sql, values),
        (error) => error.code === "42501",
      );
    await assert.rejects(
      db.query(
        "insert into public.tasks (user_id, daily_plan_id, title) values ($1, $2, 'Wrong parent')",
        [a, rows[b].daily_plans.id],
      ),
      (error) => error.code === "23503",
    );
    await assert.rejects(
      db.query("update public.tasks set daily_plan_id = $1 where id = $2", [
        rows[b].daily_plans.id,
        rows[a].tasks.id,
      ]),
      (error) => error.code === "23503",
    );
    await assert.rejects(
      db.query(
        "insert into public.daily_plans (user_id, plan_date) values ($1, '2026-09-12')",
        [a],
      ),
      (error) => error.code === "23505",
    );
    await assert.rejects(
      db.query(
        "insert into public.daily_feedback (user_id, feedback_date) values ($1, '2026-09-12')",
        [a],
      ),
      (error) => error.code === "23505",
    );
    await assert.rejects(
      db.query("update public.daily_feedback set energy_level = 6"),
      (error) => error.code === "23514",
    );
    await assert.rejects(
      db.query("update public.tasks set estimated_minutes = -1"),
      (error) => error.code === "23514",
    );
    await Promise.all(
      [1, 2].map(() =>
        db.query(
          "insert into public.daily_plans (user_id, plan_date) values ($1, '2026-09-12') on conflict (user_id, plan_date) do nothing",
          [a],
        ),
      ),
    );
    assert.equal(
      (await db.query("select main_goal from public.daily_plans")).rows[0]
        .main_goal,
      "Keep existing goal",
    );
    // A stale updated_at cannot overwrite a newer device's edit.
    assert.equal(
      (
        await db.query(
          "update public.goals set title = 'Stale' where id = $1 and updated_at = $2 returning id",
          [rows[a].goals.id, rows[a].goals.updated_at],
        )
      ).rows.length,
      0,
    );
    await db.exec("reset role; set role anon;");
    for (const table of tables)
      await assert.rejects(
        db.query(`select * from public.${table}`),
        (error) => error.code === "42501",
      );
    await login(a);
    for (const table of ["tasks", "daily_feedback", "goals", "daily_plans"]) {
      assert.equal(
        (
          await db.query(
            `delete from public.${table} where id = $1 returning id`,
            [rows[a][table].id],
          )
        ).rows.length,
        1,
        `${table}: own DELETE succeeds`,
      );
    }
    await db.exec("reset role;");
    await db.query("delete from auth.users where id = $1", [b]);
    for (const table of tables)
      assert.equal(
        (await db.query(`select * from public.${table}`)).rows.length,
        0,
        `${table}: user deletion cascades`,
      );
  } finally {
    await db.close();
  }
});
