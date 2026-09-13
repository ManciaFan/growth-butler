"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUserId } from "./auth-context";
import { createClient } from "@/lib/supabase/client";
import type { Course, ScheduleSettings } from "@/lib/supabase/database.types";
import { dateWindow } from "../../supabase/functions/_shared/plan-schema";
import {
  addDays,
  courseTime,
  DEFAULT_PERIOD_TIMES,
  validateCourse,
  validatePeriods,
  validateScheduleImport,
  type CourseEntry,
  type PeriodTime,
} from "../../supabase/functions/_shared/schedule-schema";
const failure = (error?: { code?: string } | null) =>
  new Error(
    ["42P01", "PGRST205", "PGRST202"].includes(error?.code ?? "")
      ? "课表空间尚未启用，请先执行 004_course_schedule.sql。"
      : error?.code === "23505"
        ? "这门课已存在，或其他设备已修改。请刷新后核对。"
        : "云端操作失败，未确认保存成功。请检查网络或刷新后重试。",
  );
export function ScheduleManager() {
  const userId = useUserId(),
    [start, setStart] = useState(dateWindow().today),
    [rows, setRows] = useState<Course[]>([]),
    [settings, setSettings] = useState<ScheduleSettings | null>(null),
    [times, setTimes] = useState<PeriodTime[]>(DEFAULT_PERIOD_TIMES);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [loading, setLoading] = useState(true),
    [preview, setPreview] = useState<CourseEntry[] | null>(null);
  const blank = () => ({
    course_date: dateWindow().today,
    title: "",
    period_start: 1,
    period_end: 2,
    location: "",
  });
  const [draft, setDraft] = useState<CourseEntry>(blank),
    [editing, setEditing] = useState<Course | null>(null);
  const lock = useRef(false),
    newId = useRef<string | null>(null);
  const fetchWeek = useCallback(async () => {
    const { data, error } = await createClient()
      .from("course_schedule")
      .select("*")
      .eq("user_id", userId)
      .gte("course_date", start)
      .lte("course_date", addDays(start, 6))
      .order("course_date")
      .order("period_start");
    if (error) throw failure(error);
    return data;
  }, [userId, start]);
  useEffect(() => {
    let live = true;
    fetchWeek()
      .then((data) => {
        if (live) setRows(data);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [fetchWeek]);
  useEffect(() => {
    let live = true;
    createClient()
      .from("schedule_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setError(failure(error).message);
        else {
          setSettings(data);
          setTimes(validatePeriods(data?.period_times ?? DEFAULT_PERIOD_TIMES));
        }
      });
    return () => {
      live = false;
    };
  }, [userId]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save() {
    const entry = validateCourse(draft);
    newId.current ??= crypto.randomUUID();
    const db = createClient();
    const result = editing
      ? await db
          .from("course_schedule")
          .update(entry)
          .eq("user_id", userId)
          .eq("id", editing.id)
          .eq("updated_at", editing.updated_at)
          .select("*")
          .single()
      : await db
          .from("course_schedule")
          .upsert(
            { ...entry, id: newId.current, user_id: userId },
            { onConflict: "id", ignoreDuplicates: true },
          )
          .select("*")
          .maybeSingle();
    if (result.error) throw failure(result.error);
    if (!result.data) {
      const check = await db
        .from("course_schedule")
        .select("*")
        .eq("id", newId.current)
        .eq("user_id", userId)
        .single();
      if (
        check.error ||
        !check.data ||
        Object.keys(entry).some(
          (k) =>
            check.data[k as keyof Course] !== entry[k as keyof CourseEntry],
        )
      )
        throw failure(check.error);
    }
    setRows(await fetchWeek());
    setEditing(null);
    setDraft(blank());
    newId.current = null;
    setStatus("课程已保存到云端。");
  }
  async function importFile(file: File) {
    if (file.size > 1000000)
      throw Error("课表文件过大，请使用小于 1 MB 的文件。");
    let value;
    try {
      value = JSON.parse(await file.text());
    } catch {
      throw Error("请选择整理好的课表 .json 文件，不能直接读取原始 Excel。");
    }
    setPreview(validateScheduleImport(value));
  }
  async function saveTimes() {
    const valid = validatePeriods(times);
    const db = createClient();
    const result = settings
      ? await db
          .from("schedule_settings")
          .update({ period_times: valid })
          .eq("user_id", userId)
          .eq("updated_at", settings.updated_at)
          .select("*")
          .single()
      : await db
          .from("schedule_settings")
          .insert({ user_id: userId, period_times: valid })
          .select("*")
          .single();
    if (result.error) throw failure(result.error);
    setSettings(result.data);
    setTimes(result.data.period_times);
    setStatus("作息时间已保存到云端。");
  }
  const visibleTimes = settings?.period_times ?? [];
  return (
    <div className="schedule-space">
      <section className="card">
        <div className="section-heading">
          <h2>我的课程</h2>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                setRows(await fetchWeek());
                const r = await createClient()
                  .from("schedule_settings")
                  .select("*")
                  .eq("user_id", userId)
                  .maybeSingle();
                if (r.error) throw failure(r.error);
                setSettings(r.data);
                setTimes(r.data?.period_times ?? []);
                setStatus("已刷新云端课表。");
              })
            }
          >
            刷新课表
          </button>
        </div>
        <div className="preview-actions stack-form">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              setLoading(true);
              setStart(addDays(start, -7));
            }}
          >
            前七天
          </button>
          <label>
            查看日期
            <input
              type="date"
              required
              value={start}
              disabled={busy}
              onChange={(e) => {
                if (e.target.value) {
                  setLoading(true);
                  setStart(e.target.value);
                }
              }}
            />
          </label>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              setLoading(true);
              setStart(addDays(start, 7));
            }}
          >
            后七天
          </button>
        </div>
        <p className="card-footnote">
          北京时间 · {start} 至 {addDays(start, 6)}
          。管家只读取相关日期，不会发送整学期课表。
        </p>
        {loading ? (
          <p role="status">正在读取课程……</p>
        ) : rows.length ? (
          <div className="schedule-list">
            {rows.map((row) => (
              <article className="schedule-course" key={row.id}>
                <div>
                  <small>
                    {row.course_date} · 第 {row.period_start}–{row.period_end}{" "}
                    节
                  </small>
                  <h3>{row.title}</h3>
                  <p>
                    {courseTime(row, visibleTimes) ?? "具体时间待设置"}
                    {row.location ? ` · ${row.location}` : ""}
                  </p>
                </div>
                <div className="preview-actions">
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(row);
                      setDraft({
                        course_date: row.course_date,
                        title: row.title,
                        period_start: row.period_start,
                        period_end: row.period_end,
                        location: row.location,
                      });
                      newId.current = null;
                    }}
                  >
                    修改
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `删除 ${row.course_date} 的“${row.title}”？`,
                        )
                      )
                        run(async () => {
                          const r = await createClient()
                            .from("course_schedule")
                            .delete()
                            .eq("user_id", userId)
                            .eq("id", row.id)
                            .eq("updated_at", row.updated_at)
                            .select("id")
                            .single();
                          if (r.error) throw failure(r.error);
                          setRows(await fetchWeek());
                          setStatus("课程已删除。");
                        });
                    }}
                  >
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">
            这几天还没有保存课程。可以导入课表，或在下方添加。
          </p>
        )}
      </section>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="save-status" role="status">
          {status}
        </p>
      )}
      <section className="card">
        <h2>导入课表</h2>
        <p className="muted">
          选择整理好的课表文件，核对后一次保存。重复导入不会覆盖已保存的同名、同日期、同节次课程。
        </p>
        <label className="secondary-button">
          选择课表文件
          <input
            className="schedule-file"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) run(() => importFile(f));
            }}
          />
        </label>
        {preview && (
          <div className="plan-preview">
            <h3>待导入 {preview.length} 条课程</h3>
            <div className="schedule-import-review">
              {preview.map((r, i) => (
                <p key={i}>
                  {r.course_date} · 第 {r.period_start}–{r.period_end} 节 ·{" "}
                  {r.title} · {r.location}
                </p>
              ))}
            </div>
            <div className="preview-actions">
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const { data, error } = await createClient().rpc(
                      "import_course_schedule",
                      { p_entries: preview },
                    );
                    if (error || typeof data !== "number") throw failure(error);
                    setRows(await fetchWeek());
                    setPreview(null);
                    setStatus(
                      `导入完成：新增 ${data} 条，其余相同课程已跳过。`,
                    );
                  })
                }
              >
                确认保存课表
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                取消导入
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="card">
        <h2>{editing ? "修改课程" : "添加课程"}</h2>
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(save);
          }}
        >
          <fieldset disabled={busy}>
            <label>
              课程名称
              <input
                required
                maxLength={160}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label>
              上课日期
              <input
                type="date"
                required
                value={draft.course_date}
                onChange={(e) =>
                  setDraft({ ...draft, course_date: e.target.value })
                }
              />
            </label>
            <div className="inline-fields">
              <label>
                开始节次
                <input
                  type="number"
                  min={1}
                  max={14}
                  required
                  value={draft.period_start}
                  onChange={(e) =>
                    setDraft({ ...draft, period_start: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                结束节次
                <input
                  type="number"
                  min={draft.period_start}
                  max={14}
                  required
                  value={draft.period_end}
                  onChange={(e) =>
                    setDraft({ ...draft, period_end: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <label>
              教室
              <input
                maxLength={160}
                value={draft.location}
                onChange={(e) =>
                  setDraft({ ...draft, location: e.target.value })
                }
              />
            </label>
            <div className="preview-actions">
              <button className="primary-button">保存课程</button>
              {editing && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setEditing(null);
                    setDraft(blank());
                    newId.current = null;
                  }}
                >
                  取消修改
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </section>
      <section className="card">
        <h2>学校作息时间</h2>
        <p className="muted">
          设置一次即可用于所有课程。暂不清楚的节次可以留空，管家不会猜测几点上下课。
        </p>
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(saveTimes);
          }}
        >
          <fieldset disabled={busy}>
            <div className="period-grid">
              {Array.from({ length: 14 }, (_, i) => i + 1).map((period) => {
                const t = times.find((p) => p.period === period);
                return (
                  <div key={period}>
                    <strong>第 {period} 节</strong>
                    {(["start", "end"] as const).map((k) => (
                      <label key={k}>
                        {k === "start" ? "上课" : "下课"}
                        <input
                          aria-label={`第${period}节${k === "start" ? "上课" : "下课"}`}
                          type="time"
                          value={t?.[k] ?? ""}
                          onChange={(e) => {
                            const next = {
                              period,
                              start: t?.start ?? "",
                              end: t?.end ?? "",
                              [k]: e.target.value,
                            };
                            setTimes([
                              ...times.filter((p) => p.period !== period),
                              ...(next.start || next.end ? [next] : []),
                            ]);
                          }}
                        />
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
            <button className="primary-button">保存作息时间</button>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
