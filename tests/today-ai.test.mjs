import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateToday,
  validateTodayContext,
  todayIntent,
} from "../supabase/functions/_shared/today-schema.ts";
import { validateChat } from "../supabase/functions/_shared/chat-schema.ts";
import { generateJSON } from "../supabase/functions/generate-tomorrow-plan/provider.ts";
import { handleChat } from "../supabase/functions/butler-chat/handler.ts";
import { randomUUID as uuid } from "node:crypto";
import { dateWindow } from "../supabase/functions/_shared/plan-schema.ts";
const now = new Date("2026-09-14T16:00:00+08:00");
const task = {
  source_task_id: null,
  title: "写提纲",
  start_time: "17:00",
  end_time: "17:30",
  estimated_minutes: 30,
  reason: "减少负担",
  success_criteria: "列出三点",
};
const revision = { reason: "临时有事", tasks: [task] };
const snapshot = {
  date: "2026-09-14",
  plan: { id: "plan" },
  tasks: [
    {
      id: "done",
      title: "已完成",
      completed: true,
      scheduled_start: null,
      scheduled_end: null,
    },
    {
      id: "past",
      title: "正在做",
      completed: false,
      scheduled_start: "2026-09-14T15:55:00+08:00",
      scheduled_end: "2026-09-14T16:20:00+08:00",
    },
  ],
  fixed_blocks: [{ title: "课程", start: 1080, end: 1175 }],
  unknown_courses: 0,
};
test("explicit today requests, strict JSON and protected/time constraints", () => {
  for (const s of [
    "更新今天的计划",
    "重新排今天剩下时间",
    "我今天临时有事，帮我调整",
  ])
    assert.equal(todayIntent(s), true);
  for (const s of [
    "明天怎么安排",
    "今天过得如何",
    "明天临时有事帮我调整",
    "不要调整今天的计划",
  ])
    assert.equal(todayIntent(s), false);
  assert.deepEqual(
    validateChat({
      reply: "请确认",
      memory_proposal: null,
      plan_revision: null,
      today_revision: revision,
    }).today_revision,
    revision,
  );
  validateTodayContext(validateToday(revision), snapshot, now);
  for (const tasks of [
    [{ ...task, estimated_minutes: 31 }],
    [task, task],
    [{ ...task, end_time: "25:00" }],
    [{ ...task, completed: false }],
  ])
    assert.throws(() => validateToday({ ...revision, tasks }));
  for (const tasks of [
    [{ ...task, title: "已完成" }],
    [{ ...task, source_task_id: "done" }],
    [{ ...task, start_time: "16:10", end_time: "16:40" }],
    [{ ...task, start_time: "18:10", end_time: "18:40" }],
    [{ ...task, start_time: "15:00", end_time: "15:30" }],
  ])
    assert.throws(() =>
      validateTodayContext({ ...revision, tasks }, snapshot, now),
    );
  assert.throws(() =>
    validateTodayContext(revision, { ...snapshot, unknown_courses: 1 }, now),
  );
});
test("today invalid model output retries at most once and never accepts invalid second result", async () => {
  let count = 0;
  const config = {
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com",
    model: "test",
  };
  const fetcher = async () => {
    count++;
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                ...revision,
                tasks: [{ ...task, estimated_minutes: 0 }],
              }),
            },
          },
        ],
      }),
    );
  };
  await assert.rejects(
    generateJSON({}, config, "test", validateToday, fetcher),
  );
  assert.equal(count, 2);
});
test("authenticated today chat reads snapshot and current constraints, saves only preview, cached retries do not call AI", async () => {
  const owner = uuid(),
    sid = uuid(),
    mid = uuid(),
    dates = dateWindow();
  const currentSnapshot = {
    ...snapshot,
    date: dates.today,
    tasks: [],
    fixed_blocks: [],
  };
  const tables = {
    chat_sessions: [{ id: sid, user_id: owner, archived: false }],
    chat_messages: [],
    memories: [
      {
        id: uuid(),
        user_id: owner,
        status: "active",
        category: "时间",
        key: "健身",
        value: "健身至少3小时含通勤",
        confidence: "high",
      },
    ],
    goals: [
      { user_id: owner, status: "active", title: "实习", description: "" },
    ],
    daily_plans: [],
    tasks: [],
    daily_feedback: [],
    period_summaries: [],
    course_schedule: [],
    schedule_settings: [],
  };
  const rpcCalls = [];
  let calls = 0;
  const db = {
    auth: {
      getUser: async () => ({ data: { user: { id: owner } }, error: null }),
    },
    rpc: async (name) => {
      rpcCalls.push(name);
      return {
        data: name === "claim_chat_turn" ? true : currentSnapshot,
        error: null,
      };
    },
    from(table) {
      let rows = [...tables[table]],
        single = false,
        mutation;
      const q = {
        select() {
          return q;
        },
        eq(k, v) {
          rows = rows.filter((r) => r[k] === v);
          return q;
        },
        contains(k, v) {
          rows = rows.filter((r) =>
            Object.entries(v).every(([a, b]) => r[k]?.[a] === b),
          );
          return q;
        },
        in(k, v) {
          rows = rows.filter((r) => v.includes(r[k]));
          return q;
        },
        gte() {
          return q;
        },
        lte() {
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        maybeSingle() {
          single = true;
          return q;
        },
        single() {
          single = true;
          return q;
        },
        insert(v) {
          mutation = ["insert", v];
          return q;
        },
        update(v) {
          mutation = ["update", v];
          return q;
        },
        then(resolve, reject) {
          if (mutation) {
            assert.equal(
              table,
              "chat_messages",
              "chat must never mutate plans/tasks",
            );
            if (mutation[0] === "insert") {
              const r = { id: uuid(), ...mutation[1] };
              tables[table].push(r);
              rows = [r];
            } else rows.forEach((r) => Object.assign(r, mutation[1]));
          }
          return Promise.resolve({
            data: single ? (rows[0] ?? null) : rows,
            error: null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  const deps = {
    createUserClient: () => db,
    now: () => new Date(dates.today + "T16:00:00+08:00"),
    getAIConfig: () => ({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "test",
    }),
    fetcher: async (_url, init) => {
      calls++;
      const content = JSON.parse(init.body).messages[1].content;
      const context = JSON.parse(content.slice(content.indexOf("\n") + 1));
      assert.ok(context.today_replanning.current_time.includes("16:00:00"));
      assert.equal(context.today_replanning.timezone, "Asia/Shanghai");
      assert.ok(JSON.stringify(context.active_memories).includes("3小时"));
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  reply: "请确认后应用",
                  memory_proposal: null,
                  plan_revision: null,
                  today_revision: revision,
                }),
              },
            },
          ],
        }),
      );
    },
  };
  const request = () =>
    new Request("https://example.test", {
      method: "POST",
      headers: { Authorization: "Bearer test-jwt" },
      body: JSON.stringify({
        message_id: mid,
        session_id: sid,
        content: "更新今天的计划",
        preview: null,
      }),
    });
  const response = await handleChat(request(), deps);
  assert.equal(
    response.status,
    200,
    JSON.stringify(await response.clone().json()),
  );
  assert.deepEqual(
    tables.chat_messages[0].metadata.today_snapshot,
    currentSnapshot,
  );
  assert.ok(tables.chat_messages[0].metadata.today_generated_at);
  assert.deepEqual(rpcCalls, [
    "claim_chat_turn",
    "get_today_replanning_snapshot",
  ]);
  assert.equal(tables.tasks.length, 0);
  assert.equal((await handleChat(request(), deps)).status, 200);
  assert.equal(calls, 1);
});
