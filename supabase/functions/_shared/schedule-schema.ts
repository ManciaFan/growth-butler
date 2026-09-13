export type CourseEntry = {
  course_date: string;
  title: string;
  period_start: number;
  period_end: number;
  location: string;
};
export type PeriodTime = { period: number; start: string; end: string };
export const DEFAULT_PERIOD_TIMES: PeriodTime[] = [
  { period: 1, start: "08:00", end: "08:45" },
  { period: 2, start: "08:50", end: "09:35" },
  { period: 3, start: "09:55", end: "10:40" },
  { period: 4, start: "10:45", end: "11:30" },
  { period: 5, start: "13:30", end: "14:15" },
  { period: 6, start: "14:20", end: "15:05" },
  { period: 7, start: "15:25", end: "16:10" },
  { period: 8, start: "16:15", end: "17:00" },
  { period: 9, start: "18:00", end: "18:45" },
  { period: 10, start: "18:50", end: "19:35" },
  { period: 11, start: "19:55", end: "20:30" },
  { period: 12, start: "20:35", end: "21:30" },
];
export function isDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function validateCourse(value: unknown): CourseEntry {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("课程格式不正确。");
  const v = value as CourseEntry;
  if (
    Object.keys(v).sort().join() !==
      "course_date,location,period_end,period_start,title" ||
    !isDate(v.course_date) ||
    typeof v.title !== "string" ||
    !v.title.trim() ||
    v.title.length > 160 ||
    typeof v.location !== "string" ||
    v.location.length > 160 ||
    !Number.isInteger(v.period_start) ||
    !Number.isInteger(v.period_end) ||
    v.period_start < 1 ||
    v.period_end < v.period_start ||
    v.period_end > 14
  )
    throw Error("请检查课程日期、名称和节次（1～14）。");
  return { ...v, title: v.title.trim(), location: v.location.trim() };
}
export function validateScheduleImport(value: unknown): CourseEntry[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("entries" in value) ||
    !Array.isArray(value.entries) ||
    value.entries.length < 1 ||
    value.entries.length > 1000
  )
    throw Error("课表文件需要包含 1～1000 条 entries 课程记录。");
  return value.entries.map(validateCourse);
}
export function validatePeriods(value: unknown): PeriodTime[] {
  if (!Array.isArray(value) || value.length > 14)
    throw Error("作息时间格式不正确。");
  const times = value as PeriodTime[];
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (
    times.some(
      (p) =>
        !p ||
        Object.keys(p).sort().join() !== "end,period,start" ||
        !Number.isInteger(p.period) ||
        p.period < 1 ||
        p.period > 14 ||
        typeof p.start !== "string" ||
        typeof p.end !== "string" ||
        !clock.test(p.start) ||
        !clock.test(p.end) ||
        p.start >= p.end,
    ) ||
    new Set(times.map((p) => p.period)).size !== times.length
  )
    throw Error("请填写正确的上下课时间，结束时间必须晚于开始时间。");
  const sorted = [...times].sort((a, b) => a.period - b.period);
  if (sorted.some((p, i) => i > 0 && sorted[i - 1].end > p.start))
    throw Error("不同节次的时间不能重叠或倒序。");
  return sorted;
}
export function courseTime(entry: CourseEntry, times: PeriodTime[]) {
  const selected = times
    .filter(
      (t) => t.period >= entry.period_start && t.period <= entry.period_end,
    )
    .sort((a, b) => a.period - b.period);
  return selected.length === entry.period_end - entry.period_start + 1
    ? `${selected[0].start}–${selected.at(-1)!.end}`
    : null;
}
export function addDays(date: string, days: number) {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
// Only relevant dates are queried, never the entire term. No extra model round-trip.
export function scheduleDates(message: string, today: string): string[] {
  const explicit = message.match(/\d{4}-\d{2}-\d{2}/g)?.filter(isDate);
  if (explicit?.length) return [...new Set(explicit)].slice(0, 7);
  if (
    !/课|安排|计划|空闲|时间|忙|今天|明天|后天|周|星期|礼拜|schedule|class/i.test(
      message,
    )
  )
    return [];
  const day = new Date(today + "T00:00:00Z").getUTCDay() || 7;
  const weekday = message.match(
    /(下|本|这)?(?:周|星期|礼拜)([一二三四五六日天])/,
  );
  if (weekday) {
    const n =
      "一二三四五六日".indexOf(weekday[2] === "天" ? "日" : weekday[2]) + 1;
    return [addDays(today, n - day + (weekday[1] === "下" ? 7 : 0))];
  }
  if (/下周|本周|这周/.test(message)) {
    const monday = addDays(today, 1 - day + (/下周/.test(message) ? 7 : 0));
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }
  if (message.includes("后天")) return [addDays(today, 2)];
  if (message.includes("明天")) return [addDays(today, 1)];
  if (message.includes("今天")) return [today];
  return [today, addDays(today, 1)];
}
