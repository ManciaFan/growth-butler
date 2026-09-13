"use client";
import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  adoptTomorrowPlan,
  generateTomorrowPlan,
  type PlanPreview,
} from "@/lib/ai-plan";
export function TomorrowPlanner({
  sourceDate,
  sourceVersion,
  disabled,
  dirty,
  onBusy,
}: {
  sourceDate: string;
  sourceVersion: string;
  disabled: boolean;
  dirty: boolean;
  onBusy: (value: boolean) => void;
}) {
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [pending, setPending] = useState<"generate" | "adopt" | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [previewVersion, setPreviewVersion] = useState("");
  const stale = !!preview && previewVersion !== sourceVersion;
  const lock = useRef(false);
  const planId = useRef<string | null>(null);
  async function generate() {
    if (lock.current || disabled || dirty) return;
    lock.current = true;
    setPending("generate");
    onBusy(true);
    setError("");
    setPreview(null);
    setSaved(false);
    planId.current = null;
    try {
      setPreview(await generateTomorrowPlan(sourceDate));
      setPreviewVersion(sourceVersion);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "生成失败，请稍后重试。",
      );
    } finally {
      lock.current = false;
      setPending(null);
      onBusy(false);
    }
  }
  async function adopt() {
    if (!preview || lock.current || disabled || dirty || saved || stale) return;
    lock.current = true;
    setPending("adopt");
    onBusy(true);
    setError("");
    try {
      planId.current ??= crypto.randomUUID();
      await adoptTomorrowPlan(preview, planId.current);
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "保存失败，尚未确认保存成功。请重试。",
      );
    } finally {
      lock.current = false;
      setPending(null);
      onBusy(false);
    }
  }
  return (
    <section
      className="card tomorrow-planner"
      aria-labelledby="tomorrow-heading"
    >
      <div className="section-heading">
        <h2 id="tomorrow-heading">
          <Sparkles size={19} /> 和今天好好告别
        </h2>
        <span className="tag">AI 成长管家</span>
      </div>
      <p className="muted">
        总结今天，给明天留一个清晰的小方向。AI 建议会先预览，由你决定是否采用。
      </p>
      <p className="card-footnote">
        点击生成后，将发送活跃目标、今日已保存的计划与反馈，以及含今天在内最近 7
        天的计划和完成情况给 DeepSeek。临时重要安排请先写入今日反馈并保存。
      </p>
      {dirty && (
        <p className="draft-warning">
          你有未保存的内容，请先保存或清空草稿，再生成或采用计划。
        </p>
      )}
      {!preview && !saved && (
        <button
          className="primary-button"
          disabled={disabled || dirty || !!pending}
          onClick={generate}
        >
          {pending === "generate"
            ? "AI 正在分析今天……"
            : "结束今天，生成明日计划"}
        </button>
      )}
      {pending && (
        <p role="status" className="save-status">
          {pending === "generate"
            ? "正在分析，通常需要几十秒。请勿重复点击。"
            : "正在保存明日计划，请稍候……"}
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="plan-preview">
          {stale && !saved && <p className="draft-warning">今天的记录已改变，请重新生成后再采用。</p>}
          <p className="eyebrow">
            {preview.plan_date} · 明日计划{saved ? " · 已采用" : " · 尚未保存"}
          </p>
          <h3>今日总结</h3>
          <p className="preserve-lines">{preview.proposal.today_summary}</p>
          <h3>调整原因</h3>
          <p className="preserve-lines">{preview.proposal.adjustment_reason}</p>
          <div className="preview-main-goal">
            <h3>明日主目标</h3>
            <p className="preserve-lines">
              {preview.proposal.tomorrow_main_goal}
            </p>
          </div>
          <h3>
            明日任务 · 共{" "}
            {preview.proposal.tasks.reduce(
              (total, task) => total + task.estimated_minutes,
              0,
            )}{" "}
            分钟
          </h3>
          {preview.proposal.tasks.length === 0 ? (
            <p>明天不安排核心任务，给自己一点恢复的空间。</p>
          ) : (
            <ol className="preview-tasks">
              {preview.proposal.tasks.map((task, index) => (
                <li key={index}>
                  <div className="section-heading">
                    <strong>{task.title}</strong>
                    <span className="tag">{task.estimated_minutes} 分钟</span>
                  </div>
                  <p className="preserve-lines">
                    <b>安排原因：</b>
                    {task.reason}
                  </p>
                  <p className="preserve-lines">
                    <b>完成标准：</b>
                    {task.success_criteria}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {saved ? (
            <p role="status" className="save-status">
              明日计划已保存到云端。明天打开首页即可继续执行。
            </p>
          ) : (
            <div className="preview-actions">
              <button
                className="primary-button"
                disabled={disabled || dirty || !!pending || stale}
                onClick={adopt}
              >
                采用此计划
              </button>
              <button
                className="secondary-button"
                disabled={disabled || dirty || !!pending}
                onClick={generate}
              >
                重新生成
              </button>
              <button
                className="secondary-button"
                disabled={!!pending}
                onClick={() => {
                  setPreview(null);
                  setError("");
                  planId.current = null;
                }}
              >
                取消
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
