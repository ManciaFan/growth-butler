import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dateWindow,
  normalizedTitle,
  type PlanProposal,
} from "../_shared/plan-schema.ts";
import { PlanError } from "./errors.ts";
type PlanRow = { id: string; plan_date: string; main_goal: string };
type TaskRow = {
  daily_plan_id: string;
  title: string;
  completed: boolean;
  estimated_minutes: number;
};
type GoalRow = { title: string; description: string };
type FeedbackRow = { content: string; energy_level: number | null };
export type PlanningContext = {
  active_goals: GoalRow[];
  today: {
    date: string;
    main_goal: string;
    tasks: Omit<TaskRow, "daily_plan_id">[];
    feedback: FeedbackRow | null;
  };
  recent_days: {
    date: string;
    main_goal: string;
    total_tasks: number;
    completed_tasks: number;
    completion_rate: number | null;
    completed_titles: string[];
  }[];
};
function read<T>(response: { data: T; error: unknown }): T {
  if (response.error) throw new PlanError("DATABASE_ERROR", 503);
  return response.data;
}
export async function loadContext(
  db: SupabaseClient,
  userId: string,
  dates: ReturnType<typeof dateWindow>,
  forChat = false,
): Promise<PlanningContext> {
  const existing = read(
    await db
      .from("daily_plans")
      .select("id")
      .eq("user_id", userId)
      .eq("plan_date", dates.tomorrow)
      .maybeSingle(),
  );
  if (existing && !forChat) throw new PlanError("PLAN_EXISTS", 409);
  const [goalsResponse, plansResponse, feedbackResponse] = await Promise.all([
    db
      .from("goals")
      .select("title,description")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at")
      .limit(21),
    db
      .from("daily_plans")
      .select("id,plan_date,main_goal")
      .eq("user_id", userId)
      .gte("plan_date", dates.start)
      .lte("plan_date", dates.today)
      .order("plan_date")
      .limit(7),
    db
      .from("daily_feedback")
      .select("content,energy_level")
      .eq("user_id", userId)
      .eq("feedback_date", dates.today)
      .maybeSingle(),
  ]);
  const goals = read(goalsResponse) as GoalRow[];
  const plans = read(plansResponse) as PlanRow[];
  const feedback = read(feedbackResponse) as FeedbackRow | null;
  if (goals.length > 20) throw new PlanError("CONTEXT_TOO_LARGE", 422);
  const today = plans.find((plan) => plan.plan_date === dates.today);
  if (!today && !forChat) throw new PlanError("TODAY_MISSING", 409);
  const tasks = plans.length
    ? (read(
        await db
          .from("tasks")
          .select("daily_plan_id,title,completed,estimated_minutes")
          .eq("user_id", userId)
          .in(
            "daily_plan_id",
            plans.map((plan) => plan.id),
          )
          .order("sort_order")
          .order("id")
          .limit(201),
      ) as TaskRow[])
    : [];
  if (tasks.length > 200) throw new PlanError("CONTEXT_TOO_LARGE", 422);
  const context: PlanningContext = {
    active_goals: goals,
    today: {
      date: dates.today,
      main_goal: today?.main_goal ?? "",
      tasks: tasks
        .filter((task) => task.daily_plan_id === today?.id)
        .map(({ title, completed, estimated_minutes }) => ({
          title,
          completed,
          estimated_minutes,
        })),
      feedback,
    },
    recent_days: plans.map((plan) => {
      const dailyTasks = tasks.filter((task) => task.daily_plan_id === plan.id);
      const done = dailyTasks.filter((task) => task.completed);
      return {
        date: plan.plan_date,
        main_goal: plan.main_goal,
        total_tasks: dailyTasks.length,
        completed_tasks: done.length,
        completion_rate: dailyTasks.length
          ? done.length / dailyTasks.length
          : null,
        completed_titles: done.map((task) => task.title),
      };
    }),
  };
  if (JSON.stringify(context).length > 24000)
    throw new PlanError("CONTEXT_TOO_LARGE", 422);
  return context;
}
export function validatePlanningRules(
  proposal: PlanProposal,
  context: PlanningContext,
) {
  const completed = new Set(
    context.recent_days
      .flatMap((day) => day.completed_titles)
      .map(normalizedTitle),
  );
  if (proposal.tasks.some((task) => completed.has(normalizedTitle(task.title))))
    throw new Error("Repeats completed work");
  const latest = context.recent_days.slice(-3);
  if (
    latest.length === 3 &&
    latest.every(
      (day) => day.completion_rate !== null && day.completion_rate < 0.5,
    ) &&
    (proposal.tasks.length > 2 ||
      proposal.tasks.some((task) => task.estimated_minutes > 30))
  )
    throw new Error("Reduce workload after low completion");
}
