import { createClient } from "@/lib/supabase/client";
import type {
  DailyPlan,
  Feedback,
  Goal,
  GoalStatus,
  Task,
} from "@/lib/supabase/database.types";

// One explicit calendar timezone keeps the same day consistent across devices.
export function todayDate(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function ensureToday(date: string) {
  if (date !== todayDate())
    throw new Error("日期已变化，请刷新云端数据后再保存今天的内容。");
}
export function errorMessage(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (["42P01", "PGRST205"].includes(code))
    return "数据库尚未初始化，请先在 Supabase 执行 001_initial_schema.sql。";
  if (code === "23505")
    return "其他设备可能已创建这条记录。请刷新云端数据后确认，不要重复提交。";
  if (code === "42501")
    return "没有操作权限。请重新登录，并检查数据库 RLS 配置。";
  if (code === "PGRST116") return "记录已被修改或删除，请刷新云端数据后再试。";
  if (error instanceof Error && /日期已变化|请先登录/.test(error.message))
    return error.message;
  return "请求失败，尚未确认保存成功。请检查网络后刷新核实，草稿仍保留在本页。";
}
function result<T>({
  data,
  error,
}: {
  data: T;
  error: unknown;
}): NonNullable<T> {
  if (error) throw error;
  if (data === null || data === undefined)
    throw new Error("服务器未返回记录。");
  return data as NonNullable<T>;
}
export async function loadToday(userId: string) {
  const db = createClient();
  const date = todayDate();
  // ON CONFLICT DO NOTHING avoids overwriting another device's main goal.
  const created = await db
    .from("daily_plans")
    .upsert(
      { user_id: userId, plan_date: date },
      { onConflict: "user_id,plan_date", ignoreDuplicates: true },
    );
  if (created.error) throw created.error;
  const plan = result(
    await db
      .from("daily_plans")
      .select("*")
      .eq("user_id", userId)
      .eq("plan_date", date)
      .single(),
  );
  const [tasksResponse, feedbackResponse] = await Promise.all([
    db
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .eq("daily_plan_id", plan.id)
      .order("sort_order")
      .order("created_at")
      .order("id"),
    db
      .from("daily_feedback")
      .select("*")
      .eq("user_id", userId)
      .eq("feedback_date", date)
      .maybeSingle(),
  ]);
  if (feedbackResponse.error) throw feedbackResponse.error;
  return {
    plan,
    tasks: result(tasksResponse),
    feedback: feedbackResponse.data,
  };
}
export type TodayData = Awaited<ReturnType<typeof loadToday>>;
export async function saveMainGoal(plan: DailyPlan, mainGoal: string) {
  ensureToday(plan.plan_date);
  return result(
    await createClient()
      .from("daily_plans")
      .update({ main_goal: mainGoal.trim() })
      .eq("user_id", plan.user_id)
      .eq("id", plan.id)
      .eq("updated_at", plan.updated_at)
      .select()
      .single(),
  );
}
export async function addTask(
  plan: DailyPlan,
  id: string,
  title: string,
  minutes: number,
  order: number,
) {
  ensureToday(plan.plan_date);
  return result(
    await createClient()
      .from("tasks")
      .insert({
        id,
        user_id: plan.user_id,
        daily_plan_id: plan.id,
        title: title.trim(),
        estimated_minutes: minutes,
        sort_order: order,
      })
      .select()
      .single(),
  );
}
export async function toggleTask(task: Task, date: string) {
  ensureToday(date);
  return result(
    await createClient()
      .from("tasks")
      .update({ completed: !task.completed })
      .eq("user_id", task.user_id)
      .eq("id", task.id)
      .eq("updated_at", task.updated_at)
      .select()
      .single(),
  );
}
export async function saveFeedback(
  userId: string,
  date: string,
  previous: Feedback | null,
  content: string,
  energy: number | null,
) {
  ensureToday(date);
  const db = createClient();
  if (previous)
    return result(
      await db
        .from("daily_feedback")
        .update({ content: content.trim(), energy_level: energy })
        .eq("user_id", userId)
        .eq("id", previous.id)
        .eq("updated_at", previous.updated_at)
        .select()
        .single(),
    );
  return result(
    await db
      .from("daily_feedback")
      .insert({
        user_id: userId,
        feedback_date: date,
        content: content.trim(),
        energy_level: energy,
      })
      .select()
      .single(),
  );
}
export async function loadGoals(userId: string) {
  return result(
    await createClient()
      .from("goals")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  );
}
export async function saveGoal(
  userId: string,
  id: string,
  previous: Goal | null,
  fields: { title: string; description: string; status: GoalStatus },
) {
  const db = createClient();
  const values = {
    ...fields,
    title: fields.title.trim(),
    description: fields.description.trim(),
  };
  if (previous)
    return result(
      await db
        .from("goals")
        .update(values)
        .eq("user_id", userId)
        .eq("id", id)
        .eq("updated_at", previous.updated_at)
        .select()
        .single(),
    );
  return result(
    await db
      .from("goals")
      .insert({ id, user_id: userId, ...values })
      .select()
      .single(),
  );
}
export const HISTORY_PAGE_SIZE = 20;
export async function loadHistory(userId: string, page: number) {
  const db = createClient();
  const from = page * HISTORY_PAGE_SIZE;
  const plans = result(
    await db
      .from("daily_plans")
      .select("*")
      .eq("user_id", userId)
      .lt("plan_date", todayDate())
      .order("plan_date", { ascending: false })
      .range(from, from + HISTORY_PAGE_SIZE),
  );
  const hasMore = plans.length > HISTORY_PAGE_SIZE;
  const visible = plans.slice(0, HISTORY_PAGE_SIZE);
  if (!visible.length) return { days: [], hasMore };
  // Fetch in pages to avoid Supabase's default 1,000-row response cap truncating totals.
  const tasks: Task[] = [];
  for (let offset = 0; ; offset += 500) {
    const batch = result(
      await db
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .in(
          "daily_plan_id",
          visible.map((plan) => plan.id),
        )
        .order("id")
        .range(offset, offset + 499),
    );
    tasks.push(...batch);
    if (batch.length < 500) break;
  }
  const feedback = result(
    await db
      .from("daily_feedback")
      .select("*")
      .eq("user_id", userId)
      .in(
        "feedback_date",
        visible.map((plan) => plan.plan_date),
      ),
  );
  return {
    hasMore,
    days: visible.map((plan) => ({
      plan,
      tasks: tasks
        .filter((task) => task.daily_plan_id === plan.id)
        .sort(
          (a, b) =>
            a.sort_order - b.sort_order ||
            a.created_at.localeCompare(b.created_at),
        ),
      feedback:
        feedback.find((item) => item.feedback_date === plan.plan_date) ?? null,
    })),
  };
}
