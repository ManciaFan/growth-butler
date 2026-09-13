import type { SupabaseClient } from "@supabase/supabase-js";
import {
  courseTime,
  validatePeriods,
  type CourseEntry,
} from "./schedule-schema.ts";
import { PlanError } from "../generate-tomorrow-plan/errors.ts";
export async function readSchedule(
  db: SupabaseClient,
  userId: string,
  dates: string[],
) {
  if (!dates.length) return null;
  const { data, error } = await db
    .from("course_schedule")
    .select("course_date,title,period_start,period_end,location")
    .eq("user_id", userId)
    .in("course_date", dates)
    .order("course_date")
    .order("period_start")
    .limit(101);
  // Before the manually approved migration, preserve the existing planning/chat flow.
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code))
      return { status: "not_configured", dates };
    throw new PlanError("DATABASE_ERROR", 503);
  }
  if (data.length > 100) throw new PlanError("CONTEXT_TOO_LARGE", 422);
  const settings = await db
    .from("schedule_settings")
    .select("period_times")
    .eq("user_id", userId)
    .maybeSingle();
  if (settings.error) throw new PlanError("DATABASE_ERROR", 503);
  let times;
  try {
    times = validatePeriods(settings.data?.period_times ?? []);
  } catch {
    throw new PlanError("DATABASE_ERROR", 503);
  }
  return {
    dates,
    timezone: "Asia/Shanghai",
    courses: (data as CourseEntry[]).map((e) => ({
      date: e.course_date,
      title: e.title,
      periods: `${e.period_start}–${e.period_end}`,
      time: courseTime(e, times),
      location: e.location,
    })),
    notice:
      "仅这些日期已保存的课程。空记录不代表全天有空；time=null 表示作息未配置，不能猜测具体钟点。课程是占用，不要重复当成新任务。",
  };
}
