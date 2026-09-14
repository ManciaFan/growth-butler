export type TodayRevision = {
  reason: string;
  tasks: {
    source_task_id: string | null;
    title: string;
    start_time: string;
    end_time: string;
    estimated_minutes: number;
    reason: string;
    success_criteria: string;
  }[];
};
export type TodaySnapshot = {
  date: string;
  plan: { id: string } | null;
  tasks: {
    id: string;
    title: string;
    completed: boolean;
    scheduled_start: string | null;
    scheduled_end: string | null;
  }[];
  fixed_blocks: { title: string; start: number; end: number }[];
  unknown_courses: number;
};
const norm = (s: string) =>
  s.normalize("NFKC").replace(/\s/g, "").toLowerCase();
export function todayIntent(text: string) {
  if (/(不要|不用|别|暂不).{0,6}(调整|更新|重排|重新排)/.test(text))
    return false;
  if (/(明天|明日|后天)/.test(text) && !/(今天|今日)/.test(text)) return false;
  return (
    /(今天|今日|剩下|剩余|接下来|现在|临时有事)/.test(text) &&
    /(更新|调整|重排|重新排|安排|规划|帮我排)/.test(text)
  );
}
export function minutes(clock: string) {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
}
export function validateToday(value: unknown): TodayRevision {
  const v = value as TodayRevision;
  if (
    !v ||
    Object.keys(v).sort().join() !== "reason,tasks" ||
    typeof v.reason !== "string" ||
    !v.reason.trim() ||
    v.reason.length > 1600 ||
    !Array.isArray(v.tasks) ||
    v.tasks.length > 6
  )
    throw Error("Invalid today revision");
  const titles = new Set<string>(),
    ids = new Set<string>();
  for (const t of v.tasks) {
    if (
      !t ||
      Object.keys(t).sort().join() !==
        "end_time,estimated_minutes,reason,source_task_id,start_time,success_criteria,title"
    )
      throw Error("Invalid task");
    for (const [key, max] of [
      ["title", 200],
      ["reason", 1000],
      ["success_criteria", 1000],
    ] as const)
      if (typeof t[key] !== "string" || !t[key].trim() || t[key].length > max)
        throw Error("Invalid text");
    if (
      ![t.start_time, t.end_time].every(
        (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s),
      ) ||
      !Number.isInteger(t.estimated_minutes) ||
      t.estimated_minutes < 1 ||
      minutes(t.end_time) - minutes(t.start_time) !== t.estimated_minutes
    )
      throw Error("Invalid time");
    if (
      t.source_task_id !== null &&
      (typeof t.source_task_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          t.source_task_id,
        ) ||
        ids.has(t.source_task_id))
    )
      throw Error("Invalid source");
    if (t.source_task_id) ids.add(t.source_task_id);
    if (titles.has(norm(t.title))) throw Error("Duplicate title");
    titles.add(norm(t.title));
  }
  return v;
}
export function validateTodayContext(
  revision: TodayRevision,
  snapshot: TodaySnapshot,
  now = new Date(),
) {
  if (!snapshot.plan || snapshot.unknown_courses)
    throw Error("Missing plan or course times");
  const protectedTasks = snapshot.tasks.filter(
    (t) =>
      t.completed ||
      (t.scheduled_start && Date.parse(t.scheduled_start) <= +now),
  );
  const blocks = [...snapshot.fixed_blocks];
  for (const t of protectedTasks)
    if (t.scheduled_start && t.scheduled_end)
      blocks.push({
        title: t.title,
        start:
          (+new Date(t.scheduled_start) -
            +new Date(snapshot.date + "T00:00:00+08:00")) /
          60000,
        end:
          (+new Date(t.scheduled_end) -
            +new Date(snapshot.date + "T00:00:00+08:00")) /
          60000,
      });
  for (const t of revision.tasks) {
    if (
      +new Date(`${snapshot.date}T${t.start_time}:00+08:00`) <= +now ||
      protectedTasks.some((p) => norm(p.title) === norm(t.title)) ||
      (t.source_task_id &&
        (!snapshot.tasks.some((p) => p.id === t.source_task_id) ||
          protectedTasks.some((p) => p.id === t.source_task_id)))
    )
      throw Error("Protected or expired task");
    const start = minutes(t.start_time),
      end = minutes(t.end_time);
    if (blocks.some((b) => start < b.end && end > b.start))
      throw Error("Occupied time");
    blocks.push({ title: t.title, start, end });
  }
}
