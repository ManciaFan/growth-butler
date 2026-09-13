export type PlanTask = {
  title: string;
  estimated_minutes: number;
  reason: string;
  success_criteria: string;
};
export type PlanProposal = {
  today_summary: string;
  adjustment_reason: string;
  tomorrow_main_goal: string;
  tasks: PlanTask[];
};
export type PlanPreview = {
  source_date: string;
  plan_date: string;
  proposal: PlanProposal;
};

export function dateWindow(now = new Date()) {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const shift = (days: number) =>
    new Date(Date.parse(today + "T00:00:00Z") + days * 86400000)
      .toISOString()
      .slice(0, 10);
  return { today, tomorrow: shift(1), start: shift(-6) };
}
export function normalizedTitle(title: string) {
  return title.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function text(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= limit
  );
}
export function validateProposal(value: unknown): PlanProposal {
  if (
    !record(value) ||
    !exactKeys(value, [
      "today_summary",
      "adjustment_reason",
      "tomorrow_main_goal",
      "tasks",
    ]) ||
    !text(value.today_summary, 1600) ||
    !text(value.adjustment_reason, 1600) ||
    !text(value.tomorrow_main_goal, 1000) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > 3
  )
    throw new Error("Invalid plan schema");
  const titles = new Set<string>();
  const tasks = value.tasks.map((task: unknown): PlanTask => {
    if (
      !record(task) ||
      !exactKeys(task, [
        "title",
        "estimated_minutes",
        "reason",
        "success_criteria",
      ]) ||
      !text(task.title, 200) ||
      !text(task.reason, 1000) ||
      !text(task.success_criteria, 1000) ||
      typeof task.estimated_minutes !== "number" ||
      !Number.isInteger(task.estimated_minutes) ||
      task.estimated_minutes < 1 ||
      task.estimated_minutes > 480
    )
      throw new Error("Invalid task schema");
    const title = normalizedTitle(task.title);
    if (titles.has(title)) throw new Error("Duplicate task");
    titles.add(title);
    return {
      title: task.title.trim(),
      estimated_minutes: task.estimated_minutes,
      reason: task.reason.trim(),
      success_criteria: task.success_criteria.trim(),
    };
  });
  return {
    today_summary: value.today_summary.trim(),
    adjustment_reason: value.adjustment_reason.trim(),
    tomorrow_main_goal: value.tomorrow_main_goal.trim(),
    tasks,
  };
}
export function validatePreview(value: unknown): PlanPreview {
  if (
    !record(value) ||
    !exactKeys(value, ["source_date", "plan_date", "proposal"]) ||
    typeof value.source_date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.source_date) ||
    typeof value.plan_date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.plan_date)
  )
    throw new Error("Invalid preview");
  return {
    source_date: value.source_date,
    plan_date: value.plan_date,
    proposal: validateProposal(value.proposal),
  };
}
