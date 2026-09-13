"use client";
import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Check, Leaf, Sun } from "lucide-react";
import { useUserId } from "./auth-context";
import { CloudStatus } from "./cloud-status";
import { TomorrowPlanner } from "./tomorrow-planner";
import { useCloudResource } from "@/lib/use-cloud-resource";
import {
  addTask,
  errorMessage,
  loadToday,
  saveFeedback,
  saveMainGoal,
  toggleTask,
  type TodayData,
} from "@/lib/cloud";

export function TodayDashboard() {
  const userId = useUserId();
  const loader = useCallback(() => loadToday(userId), [userId]);
  const resource = useCloudResource(loader);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">A LITTLE BETTER, EVERY DAY</p>
          <h1>
            今天，也向前一点点 <Sun className="sun" size={28} />
          </h1>
          <p>把计划写下来，每个小行动都值得被记录。</p>
        </div>
      </div>
      {resource.data ? (
        <TodayEditor
          key={resource.version}
          initial={resource.data}
          loading={resource.loading}
          loadError={resource.error}
          refresh={resource.reload}
        />
      ) : (
        <CloudStatus
          loading={resource.loading}
          error={resource.error}
          refresh={resource.reload}
        />
      )}
    </>
  );
}

function TodayEditor({
  initial,
  loading,
  loadError,
  refresh,
}: {
  initial: TodayData;
  loading: boolean;
  loadError: string;
  refresh: () => Promise<void>;
}) {
  const userId = useUserId();
  const [plan, setPlan] = useState(initial.plan);
  const [tasks, setTasks] = useState(initial.tasks);
  const [feedback, setFeedback] = useState(initial.feedback);
  const [mainGoal, setMainGoal] = useState(initial.plan.main_goal);
  const [content, setContent] = useState(initial.feedback?.content ?? "");
  const [energy, setEnergy] = useState<number | null>(
    initial.feedback?.energy_level ?? null,
  );
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("20");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const taskId = useRef<string | null>(null);
  const locked = useRef(false);
  const [aiBusy, setAiBusy] = useState(false);
  const dirty =
    mainGoal !== plan.main_goal ||
    content !== (feedback?.content ?? "") ||
    energy !== (feedback?.energy_level ?? null) ||
    title !== "";
  const busy = !!pending || loading || aiBusy;
  const completed = tasks.filter((task) => task.completed).length;
  const percent = tasks.length
    ? Math.round((completed / tasks.length) * 100)
    : 0;
  async function save(name: string, operation: () => Promise<void>) {
    if (locked.current || loading || aiBusy) return;
    locked.current = true;
    setPending(name);
    setError("");
    setMessage("");
    try {
      await operation();
      setMessage("已保存到云端。");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      locked.current = false;
      setPending("");
    }
  }
  function clearMessage() {
    setMessage("");
  }
  function reload() {
    if (
      !dirty ||
      window.confirm("刷新将丢弃本页尚未保存的草稿，读取云端最新内容。继续吗？")
    )
      void refresh();
  }
  return (
    <>
      <CloudStatus
        loading={loading}
        error={loadError}
        disabled={!!pending || aiBusy}
        refresh={reload}
      />
      <p className="muted small">
        {plan.plan_date} · 日期统一使用北京时间（UTC+8）
      </p>
      <div className="save-status" aria-live="polite">
        {pending ? "正在保存，请稍候……" : message}
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <TomorrowPlanner
        sourceDate={plan.plan_date}
        sourceVersion={JSON.stringify([
          plan.updated_at,
          feedback?.updated_at,
          tasks.map((task) => [task.id, task.updated_at]),
        ])}
        disabled={!!pending || loading}
        dirty={dirty}
        onBusy={setAiBusy}
      />
      <div className="dashboard-grid">
        <div className="main-column">
          <section className="card" id="today-plan">
            <div className="section-heading">
              <h2>
                今日计划 <span className="count">{tasks.length}</span>
              </h2>
            </div>
            {tasks.length === 0 && (
              <p className="muted">
                今天的计划已创建。从添加第一件小事开始吧。
              </p>
            )}
            <div className="task-list">
              {tasks.map((task) => (
                <label
                  key={task.id}
                  className={`task-row ${task.completed ? "done" : ""}`}
                >
                  <input
                    type="checkbox"
                    aria-label={task.title}
                    checked={task.completed}
                    disabled={busy}
                    onChange={() =>
                      void save(task.id, async () => {
                        const updated = await toggleTask(task, plan.plan_date);
                        setTasks((items) =>
                          items.map((item) =>
                            item.id === updated.id ? updated : item,
                          ),
                        );
                      })
                    }
                  />
                  <span className="check-box" aria-hidden="true">
                    {task.completed && <Check size={15} />}
                  </span>
                  <span className="task-content">
                    <strong>{task.title}</strong>
                    <span>
                      {task.estimated_minutes > 0
                        ? `预计 ${task.estimated_minutes} 分钟`
                        : "未设置时长"}
                    </span>
                    {task.reason && (
                      <span className="task-detail">
                        安排原因：{task.reason}
                      </span>
                    )}
                    {task.success_criteria && (
                      <span className="task-detail">
                        完成标准：{task.success_criteria}
                      </span>
                    )}
                  </span>
                  {pending === task.id && <span className="small">保存中</span>}
                </label>
              ))}
            </div>
            <form
              className="stack-form task-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!title.trim()) return;
                void save("task", async () => {
                  taskId.current ??= crypto.randomUUID();
                  const task = await addTask(
                    plan,
                    taskId.current,
                    title,
                    Number(minutes),
                    tasks.reduce(
                      (max, item) => Math.max(max, item.sort_order + 1),
                      0,
                    ),
                  );
                  setTasks((items) => [
                    ...items.filter((item) => item.id !== task.id),
                    task,
                  ]);
                  setTitle("");
                  setMinutes("20");
                  taskId.current = null;
                });
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  添加任务
                  <input
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      clearMessage();
                    }}
                    maxLength={200}
                    required
                    placeholder="今天想完成什么？"
                  />
                </label>
                <div className="inline-fields">
                  <label>
                    预计分钟数
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      step={1}
                      required
                      value={minutes}
                      onChange={(event) => setMinutes(event.target.value)}
                    />
                  </label>
                  <button className="primary-button" disabled={!title.trim()}>
                    添加任务
                  </button>
                </div>
              </fieldset>
            </form>
          </section>
          <section className="card feedback">
            <div className="section-heading">
              <h2>今日反馈</h2>
            </div>
            <form
              className="stack-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save("feedback", async () => {
                  const updated = await saveFeedback(
                    userId,
                    plan.plan_date,
                    feedback,
                    content,
                    energy,
                  );
                  setFeedback(updated);
                  setContent(updated.content);
                });
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  今天的能量
                  <select
                    value={energy ?? ""}
                    onChange={(event) => {
                      setEnergy(
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                      );
                      clearMessage();
                    }}
                  >
                    <option value="">暂不评价</option>
                    {["很疲惫", "有点累", "还不错", "状态很好", "能量满满"].map(
                      (label, i) => (
                        <option value={i + 1} key={label}>
                          {i + 1} · {label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label htmlFor="reflection">今天的收获或感受</label>
                <textarea
                  id="reflection"
                  value={content}
                  onChange={(event) => {
                    setContent(event.target.value);
                    clearMessage();
                  }}
                  maxLength={5000}
                  placeholder="今天有什么值得记住的小事？"
                />
                <button className="primary-button">保存今日反馈</button>
              </fieldset>
            </form>
          </section>
        </div>
        <div className="side-column">
          <section className="card progress-card">
            <h2>任务完成进度</h2>
            <div
              className="progress-ring"
              role="progressbar"
              aria-label="今日任务完成进度"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{
                background: `conic-gradient(var(--green) ${percent}%, #edf0e9 0)`,
              }}
            >
              <div>
                <strong>
                  {percent}
                  <span>%</span>
                </strong>
                <small>今日完成度</small>
              </div>
            </div>
            <p className="progress-description">
              已完成 {completed} / {tasks.length} 项计划
            </p>
            <p className="encouragement">
              {tasks.length === 0
                ? "先给今天一个小小的开始。"
                : percent === 100
                  ? "今天的计划都完成啦！"
                  : "每完成一件小事，都是一次前进。"}
            </p>
          </section>
          <section className="card daily-goal">
            <div className="section-heading">
              <h2>今日目标</h2>
              <Leaf size={18} />
            </div>
            <form
              className="stack-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save("plan", async () => {
                  const updated = await saveMainGoal(plan, mainGoal);
                  setPlan(updated);
                  setMainGoal(updated.main_goal);
                });
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  今天最重要的一件事
                  <textarea
                    value={mainGoal}
                    onChange={(event) => {
                      setMainGoal(event.target.value);
                      clearMessage();
                    }}
                    maxLength={1000}
                    placeholder="给今天定一个方向"
                  />
                </label>
                <button className="primary-button">保存今日目标</button>
              </fieldset>
            </form>
            <Link href="/goals" className="text-link">
              看看我的长期目标 →
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}
