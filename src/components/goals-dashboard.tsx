"use client";
import { useCallback, useRef, useState } from "react";
import { Flag } from "lucide-react";
import { useUserId } from "./auth-context";
import { CloudStatus } from "./cloud-status";
import { useCloudResource } from "@/lib/use-cloud-resource";
import { errorMessage, loadGoals, saveGoal } from "@/lib/cloud";
import type { Goal, GoalStatus } from "@/lib/supabase/database.types";
const statuses: Record<GoalStatus, string> = {
  active: "进行中",
  completed: "已完成",
  paused: "已暂停",
};

export function GoalsDashboard() {
  const userId = useUserId();
  const loader = useCallback(() => loadGoals(userId), [userId]);
  const resource = useCloudResource(loader);
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE ROOM FOR WHAT MATTERS</p>
          <h1>目标，让努力有方向</h1>
          <p>把想成为的样子，拆成可以走的小步。</p>
        </div>
        <button
          className="primary-button"
          disabled={editing !== null || resource.loading}
          onClick={() => setEditing("new")}
        >
          新增目标
        </button>
      </div>
      <CloudStatus
        loading={resource.loading}
        error={resource.error}
        disabled={pending}
        refresh={() => {
          if (
            editing &&
            !window.confirm("刷新会关闭编辑并丢弃尚未保存的草稿，继续吗？")
          )
            return;
          setEditing(null);
          void resource.reload();
        }}
      />
      {editing && (
        <GoalForm
          key={editing === "new" ? "new" : editing.id}
          previous={editing === "new" ? null : editing}
          onPending={setPending}
          cancel={() => setEditing(null)}
          saved={(goal) => {
            resource.setData((items) => {
              const all = items ?? [];
              return all.some((item) => item.id === goal.id)
                ? all.map((item) => (item.id === goal.id ? goal : item))
                : [goal, ...all];
            });
            setEditing(null);
          }}
        />
      )}
      <div className="goal-grid">
        {resource.data?.map((goal) => (
          <section className="card goal-card" key={goal.id}>
            <span className="goal-icon">
              <Flag size={23} />
            </span>
            <span className="tag">{statuses[goal.status]}</span>
            <h2>{goal.title}</h2>
            <p className="preserve-lines">
              {goal.description || "还没有描述，给这个目标补充一些想法吧。"}
            </p>
            <button
              className="secondary-button"
              disabled={editing !== null || resource.loading}
              onClick={() => setEditing(goal)}
            >
              编辑目标<span className="sr-only">：{goal.title}</span>
            </button>
          </section>
        ))}
      </div>
      {resource.data?.length === 0 && !editing && (
        <section className="card empty-state">
          <h2>给成长一个方向</h2>
          <p>还没有长期目标，点击“新增目标”开始记录。</p>
        </section>
      )}
    </>
  );
}
function GoalForm({
  previous,
  saved,
  cancel,
  onPending,
}: {
  previous: Goal | null;
  saved: (goal: Goal) => void;
  cancel: () => void;
  onPending: (value: boolean) => void;
}) {
  const userId = useUserId();
  const [title, setTitle] = useState(previous?.title ?? "");
  const [description, setDescription] = useState(previous?.description ?? "");
  const [status, setStatus] = useState<GoalStatus>(
    previous?.status ?? "active",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useRef(previous?.id ?? "");
  const lock = useRef(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !title.trim()) return;
    lock.current = true;
    setBusy(true);
    onPending(true);
    setError("");
    try {
      id.current ||= crypto.randomUUID();
      saved(
        await saveGoal(userId, id.current, previous, {
          title,
          description,
          status,
        }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      lock.current = false;
      setBusy(false);
      onPending(false);
    }
  }
  return (
    <section className="card goal-editor">
      <h2>{previous ? "编辑长期目标" : "新增长期目标"}</h2>
      <form className="stack-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            目标标题
            <input
              value={title}
              required
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </label>
          <label>
            目标描述
            <textarea
              value={description}
              maxLength={5000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            状态
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as GoalStatus)}
            >
              {Object.entries(statuses).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="account-actions">
            <button className="primary-button" disabled={!title.trim()}>
              {busy ? "正在保存……" : "保存目标"}
            </button>
            <button className="secondary-button" type="button" onClick={cancel}>
              取消
            </button>
          </div>
        </fieldset>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
