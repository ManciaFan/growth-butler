import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { dateWindow, validateProposal } from "../supabase/functions/_shared/plan-schema.ts";
import { generateProposal } from "../supabase/functions/generate-tomorrow-plan/provider.ts";
import { handleRequest } from "../supabase/functions/generate-tomorrow-plan/handler.ts";

const config = { apiKey: "synthetic-test-credential", baseUrl: "https://api.deepseek.com/v1", model: "test-model" };
const task = { title: "阅读下一章并写三条笔记", estimated_minutes: 20, reason: "推进阅读目标", success_criteria: "完成三条笔记并各写一个应用例子" };
const proposal = { today_summary: "今天完成了第一章阅读。", adjustment_reason: "明天保持小步推进。", tomorrow_main_goal: "把下一章的想法变成笔记", tasks: [task] };
const context = { active_goals: [], today: { date: "2026-09-13", main_goal: "阅读第一章", tasks: [], feedback: null }, recent_days: [] };
const completion = value => Response.json({ choices: [{ finish_reason: "stop", message: { content: typeof value === "string" ? value : JSON.stringify(value) } }] });

test("strict schema, task limits, duplicates and Beijing date boundaries", () => {
  assert.deepEqual(validateProposal(proposal), proposal);
  assert.deepEqual(validateProposal({ ...proposal, tasks: [] }).tasks, []);
  for (const value of [null, [], { ...proposal, extra: true }, { ...proposal, today_summary: "" }, { ...proposal, tasks: [task, task] }, { ...proposal, tasks: Array.from({ length: 4 }, (_, i) => ({ ...task, title: String(i) })) }, { ...proposal, tasks: [{ ...task, estimated_minutes: "20" }] }, { ...proposal, tasks: [{ ...task, estimated_minutes: 1.5 }] }, { ...proposal, tasks: [{ ...task, estimated_minutes: 0 }] }, { ...proposal, tasks: [{ ...task, success_criteria: "" }] }]) assert.throws(() => validateProposal(value));
  assert.deepEqual(dateWindow(new Date("2026-12-31T16:00:00Z")), { today: "2027-01-01", tomorrow: "2027-01-02", start: "2026-12-26" });
});
test("one normal AI call, bounded output and no credentials in prompt", async () => {
  let calls = 0;
  const result = await generateProposal(context, config, async (url, init) => {
    calls++; assert.equal(url, "https://api.deepseek.com/v1/chat/completions");
    const body = JSON.parse(init.body);
    assert.equal(body.max_tokens, 1800); assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.stream, false); assert.equal(init.redirect, "error");
    assert.ok(!init.body.includes(config.apiKey));
    return completion(proposal);
  });
  assert.equal(calls, 1); assert.deepEqual(result, proposal);
});
test("invalid JSON/schema gets exactly one correction attempt", async () => {
  let calls = 0;
  assert.deepEqual(await generateProposal(context, config, async () => completion(++calls === 1 ? "not json" : proposal)), proposal);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(generateProposal(context, config, async () => { calls++; return completion({ ...proposal, tasks: [task, task] }); }), error => error.code === "AI_INVALID_RESPONSE");
  assert.equal(calls, 2);
});
test("completed work and persistent low completion are rejected", async () => {
  const recent = { ...context, recent_days: [1, 2, 3].map(i => ({ date: `2026-09-${10 + i}`, main_goal: "阅读", total_tasks: 3, completed_tasks: 1, completion_rate: 1 / 3, completed_titles: ["已完成的任务"] })) };
  for (const badTask of [{ ...task, title: "已完成的任务" }, { ...task, estimated_minutes: 60 }]) {
    let calls = 0;
    assert.deepEqual(await generateProposal(recent, config, async () => completion(++calls === 1 ? { ...proposal, tasks: [badTask] } : proposal)), proposal);
    assert.equal(calls, 2);
  }
});
test("provider errors are classified, sanitized and never automatically retried", async () => {
  for (const [status, code] of [[401, "AI_CONFIG_ERROR"], [402, "AI_QUOTA"], [429, "AI_RATE_LIMIT"], [503, "AI_UNAVAILABLE"], [504, "AI_TIMEOUT"]]) {
    let calls = 0;
    await assert.rejects(generateProposal(context, config, async () => { calls++; return new Response(config.apiKey, { status }); }), error => error.code === code && !error.message.includes(config.apiKey));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(generateProposal(context, config, async (_url, init) => { calls++; await delay(10); init.signal.throwIfAborted(); return completion(proposal); }, 1), error => error.code === "AI_TIMEOUT");
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(generateProposal(context, config, async () => { calls++; return new Response(new ReadableStream({ start(controller) { controller.error(new Error("network closed")); } })); }), error => error.code === "AI_UNAVAILABLE");
  assert.equal(calls, 1);
  await assert.rejects(generateProposal(context, { ...config, baseUrl: "https://untrusted.example" }, async () => { throw new Error("must not call"); }), error => error.code === "AI_CONFIG_ERROR");
  await assert.rejects(generateProposal(context, config, async () => completion({ ...proposal, today_summary: config.apiKey })), error => error.code === "AI_INVALID_RESPONSE" && !error.message.includes(config.apiKey));
});

function fakeDB({ existing = false, dbError = false, user = { id: "user-a" } } = {}) {
  const rows = {
    goals: [{ user_id: "user-a", status: "active", title: "我的目标", description: "只做一个重点" }, { user_id: "user-a", status: "completed", title: "已完成目标", description: "omit" }, { user_id: "user-b", status: "active", title: "别人目标", description: "private" }],
    daily_plans: [{ id: "today", user_id: "user-a", plan_date: "2026-09-13", main_goal: "今天主目标" }, { id: "old", user_id: "user-a", plan_date: "2026-09-01", main_goal: "过早历史" }, ...(existing ? [{ id: "tomorrow", user_id: "user-a", plan_date: "2026-09-14", main_goal: "已有明日计划" }] : [])],
    daily_feedback: [{ user_id: "user-a", feedback_date: "2026-09-13", content: "明早需要优先处理预约", energy_level: 3 }, { user_id: "user-a", feedback_date: "2026-09-12", content: "不能发送的旧反馈", energy_level: 3 }],
    tasks: [{ user_id: "user-a", daily_plan_id: "today", title: "今天的任务", completed: true, estimated_minutes: 15 }, { user_id: "user-a", daily_plan_id: "old", title: "旧任务不能发送", completed: false, estimated_minutes: 60 }],
  };
  const queries = [];
  return { queries, auth: { getUser: async () => ({ data: { user }, error: null }) }, from(table) {
    let selected = rows[table], single = false, columns;
    const query = { table, filters: [], limit: null };
    queries.push(query);
    const builder = {
      select(value) { columns = value.split(","); return builder; },
      eq(key, value) { query.filters.push(["eq", key, value]); selected = selected.filter(row => row[key] === value); return builder; },
      gte(key, value) { query.filters.push(["gte", key, value]); selected = selected.filter(row => row[key] >= value); return builder; },
      lte(key, value) { query.filters.push(["lte", key, value]); selected = selected.filter(row => row[key] <= value); return builder; },
      in(key, values) { query.filters.push(["in", key, values]); selected = selected.filter(row => values.includes(row[key])); return builder; },
      order() { return builder; }, limit(n) { query.limit = n; selected = selected.slice(0, n); return builder; },
      maybeSingle() { single = true; return builder; },
      then(resolve, reject) { const projected = selected.map(row => Object.fromEntries(columns.map(key => [key, row[key]]))); return Promise.resolve({ data: single ? projected[0] ?? null : projected, error: dbError ? { code: "42P01", message: "private error" } : null }).then(resolve, reject); },
    }; return builder;
  } };
}
const request = (body = { source_date: "2026-09-13" }, token = "user-jwt") => new Request("https://example.test/functions/v1/generate-tomorrow-plan", { method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
function dependencies(db, fetcher) { return { createUserClient: jwt => { assert.equal(jwt, "user-jwt"); return db; }, getAIConfig: () => config, now: () => new Date("2026-09-13T04:00:00Z"), fetcher }; }
test("handler requires a real user and rejects caller-supplied user IDs", async () => {
  const noUse = { createUserClient: () => { throw new Error("not reached"); }, getAIConfig: () => { throw new Error("not reached"); } };
  assert.equal((await handleRequest(request(undefined, ""), noUse)).status, 401);
  const db = fakeDB({ user: null });
  assert.equal((await handleRequest(request(), dependencies(db))).status, 401);
  assert.equal(db.queries.length, 0);
  const authenticated = fakeDB();
  assert.equal((await handleRequest(request({ source_date: "2026-09-13", user_id: "user-b" }), dependencies(authenticated))).status, 400);
  assert.equal(authenticated.queries.length, 0);
});
test("handler only sends allowed current-user context and never writes database records", async () => {
  const db = fakeDB(); let calls = 0;
  const response = await handleRequest(request(), dependencies(db, async (_url, init) => {
    calls++; const input = JSON.parse(JSON.parse(init.body).messages[1].content.split("\n").slice(1).join("\n"));
    assert.equal(input.active_goals.length, 1); assert.equal(input.today.tasks.length, 1); assert.equal(input.recent_days.length, 1);
    const serialized = JSON.stringify(input);
    for (const forbidden of ["user-a", "user-b", "别人目标", "旧任务不能发送", "不能发送的旧反馈", "过早历史", config.apiKey]) assert.ok(!serialized.includes(forbidden));
    return completion(proposal);
  }));
  assert.equal(response.status, 200); assert.equal(calls, 1);
  assert.equal((await response.json()).plan_date, "2026-09-14");
  assert.ok(db.queries.every(query => query.filters.some(filter => filter[1] === "user_id" && filter[2] === "user-a")));
  const range = db.queries.find(query => query.filters.some(filter => filter[0] === "gte"));
  assert.ok(range.filters.some(filter => filter[0] === "gte" && filter[2] === "2026-09-07"));
  assert.ok(range.filters.some(filter => filter[0] === "lte" && filter[2] === "2026-09-13"));
});
test("existing tomorrow, database failure and stale date never call AI", async () => {
  for (const [db, body, code] of [[fakeDB({ existing: true }), undefined, "PLAN_EXISTS"], [fakeDB({ dbError: true }), undefined, "DATABASE_ERROR"], [fakeDB(), { source_date: "2026-09-12" }, "DATE_CHANGED"]]) {
    let calls = 0;
    const response = await handleRequest(request(body), dependencies(db, async () => { calls++; return completion(proposal); }));
    assert.equal((await response.json()).code, code); assert.equal(calls, 0);
  }
});
