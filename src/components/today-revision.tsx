"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useUserId } from "./auth-context";
import type {
  ChatMessage,
  Database,
  Task,
} from "@/lib/supabase/database.types";
import type {
  TodayRevision,
  TodaySnapshot,
} from "../../supabase/functions/_shared/today-schema";
const clock = (s: string) =>
  new Date(s).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
export function TaskTime({
  task,
}: {
  task: Pick<Task, "scheduled_start" | "scheduled_end">;
}) {
  return task.scheduled_start && task.scheduled_end ? (
    <small className="task-detail">
      北京时间 {clock(task.scheduled_start)}–{clock(task.scheduled_end)}
    </small>
  ) : null;
}
export function TodayRevisionCard({
  message,
  revision,
}: {
  message: ChatMessage;
  revision: TodayRevision;
}) {
  const lock = useRef(false);
  const snapshot = message.metadata.today_snapshot as TodaySnapshot | undefined;
  const generated =
    typeof message.metadata.today_generated_at === "string"
      ? message.metadata.today_generated_at
      : message.created_at;
  const replaced =
    snapshot?.tasks?.filter(
      (t) =>
        !t.completed &&
        (!t.scheduled_start ||
          Date.parse(t.scheduled_start) > Date.parse(generated)),
    ) ?? [];
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(!!message.metadata.today_applied_at),
    [cancelled, setCancelled] = useState(false);
  async function apply() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await createClient().rpc("apply_today_revision", {
        p_message_id: message.id,
      });
      if (error) {
        const messages: Record<string, string> = {
          PT401: "登录已失效，请重新登录。",
          PT409: "计划、任务或长期规则已变化，请重新生成今日修订。",
          PT410: "预览已过期或任务开始时间已到，请重新生成。",
          PT422: "计划时间冲突或格式不正确，请重新生成并检查课程时间。",
          PGRST202: "今日调整尚未启用，请先执行 005 数据库迁移。",
        };
        throw Error(
          messages[error.code] ??
            "保存失败，请检查网络后重试。同一预览重试不会重复添加任务。",
        );
      }
      if (data !== message.id) throw Error("未能确认保存结果，请重试。");
      setDone(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "网络异常，未能确认保存，请重试。",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="memory-proposal" aria-label="今日剩余计划预览">
      <h3>
        今日剩余计划 · {done ? "已应用" : cancelled ? "已取消" : "待确认"}
      </h3>
      <p className="card-footnote">
        {snapshot?.date} · 生成于 {clock(generated)}
      </p>
      <p>{revision.reason}</p>
      <p className="card-footnote">
        北京时间。仅替换可调整的未完成任务；已完成、已开始和已过时段的任务保留。预览有效期为
        30 分钟，开始时间已到则需重新生成。
      </p>
      {replaced.length > 0 && (
        <details>
          <summary>将替换的原未完成安排（{replaced.length} 项）</summary>
          <ul>
            {replaced.map((t) => (
              <li key={t.id}>
                {t.title}
                <TaskTime task={t} />
              </li>
            ))}
          </ul>
        </details>
      )}
      <ul>
        {revision.tasks.map((t, i) => (
          <li key={i}>
            <strong>
              {t.start_time}–{t.end_time} · {t.title}
            </strong>
            <p>
              {t.estimated_minutes} 分钟 · {t.reason}
            </p>
            <p>完成标准：{t.success_criteria}</p>
          </li>
        ))}
      </ul>
      {!revision.tasks.length && (
        <p>撤下可调整的剩余任务，今天不再新增安排。</p>
      )}
      {done ? (
        <p role="status">
          已应用到今天。<Link href="/">回首页查看最新计划</Link>
        </p>
      ) : cancelled ? (
        <p>已取消，今日计划未修改。</p>
      ) : (
        <div className="preview-actions">
          <button className="primary-button" disabled={busy} onClick={apply}>
            {busy ? "正在保存……" : "应用到今天"}
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => setCancelled(true)}
          >
            取消
          </button>
        </div>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
type RevisionRow = Database["public"]["Tables"]["today_plan_revisions"]["Row"];
export function RevisionHistory({ planId }: { planId: string }) {
  const userId = useUserId();
  const [rows, setRows] = useState<RevisionRow[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      const result = await createClient()
        .from("today_plan_revisions")
        .select("*")
        .eq("user_id", userId)
        .eq("daily_plan_id", planId)
        .order("applied_at", { ascending: false })
        .limit(50);
      if (result.error) throw Error("调整记录读取失败，请重试。");
      setRows(result.data);
    } catch {
      setError("调整记录读取失败，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="text-button" disabled={busy} onClick={load}>
        {busy ? "正在读取……" : "查看调整记录"}
      </button>
      {error && <p role="alert">{error}</p>}
      {rows?.length === 0 && <p>暂无调整记录。</p>}
      {rows?.map((r) => (
        <details key={r.id}>
          <summary>
            {new Date(r.applied_at).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
            })}{" "}
            · {r.reason}
          </summary>
          {(
            [
              ["调整前", r.before_tasks],
              ["调整后", r.after_tasks],
            ] as const
          ).map(([label, tasks]) => (
            <div key={label}>
              <strong>{label}</strong>
              <ul>
                {tasks.map((t) => (
                  <li key={t.id}>
                    {t.completed ? "✓" : "○"} {t.title}
                    <TaskTime task={t} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      ))}
      {rows?.length === 50 && <p>显示最近 50 次调整。</p>}
    </div>
  );
}
