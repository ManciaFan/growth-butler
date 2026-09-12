"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useUserId } from "./auth-context";
import { CloudStatus } from "./cloud-status";
import { useCloudResource } from "@/lib/use-cloud-resource";
import { loadHistory } from "@/lib/cloud";
export function HistoryDashboard() {
  const userId = useUserId();
  const [page, setPage] = useState(0);
  const loader = useCallback(() => loadHistory(userId, page), [userId, page]);
  const resource = useCloudResource(loader);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">EVERY STEP LEAVES A TRACE</p>
          <h1>回头看看，走过的路</h1>
          <p>回顾今天之前的计划、完成情况和反馈。日期采用北京时间。</p>
        </div>
      </div>
      <CloudStatus
        loading={resource.loading}
        error={resource.error}
        refresh={resource.reload}
      />
      {!resource.loading &&
        !resource.error &&
        resource.data?.days.length === 0 && (
          <section className="card empty-state">
            <h2>你的故事，从今天开始</h2>
            <p>暂时没有更早的计划记录。</p>
            <Link className="primary-button" href="/">
              回到今天
            </Link>
          </section>
        )}
      {!resource.loading && !resource.error && (
        <div className="history-list">
          {resource.data?.days.map(({ plan, tasks, feedback }) => {
            const completed = tasks.filter((task) => task.completed).length;
            return (
              <details className="card history-day" key={plan.id}>
                <summary>
                  <strong>{plan.plan_date}</strong>
                  <span>
                    {completed} / {tasks.length} 项完成 ·{" "}
                    {tasks.length
                      ? Math.round((completed / tasks.length) * 100)
                      : 0}
                    %
                  </span>
                </summary>
                <h2 className="preserve-lines">
                  {plan.main_goal || "当天未填写主要目标"}
                </h2>
                {tasks.length === 0 ? (
                  <p className="muted">当天没有添加任务。</p>
                ) : (
                  <ul className="history-tasks">
                    {tasks.map((task) => (
                      <li key={task.id}>
                        <span aria-label={task.completed ? "已完成" : "未完成"}>
                          {task.completed ? "✓" : "○"}
                        </span>
                        <span className="preserve-lines">{task.title}</span>
                        <small>{task.estimated_minutes} 分钟</small>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="history-feedback">
                  <h3>
                    当日反馈
                    {feedback?.energy_level
                      ? ` · 能量 ${feedback.energy_level}/5`
                      : ""}
                  </h3>
                  <p className="preserve-lines">
                    {feedback?.content || "当天没有文字反馈。"}
                  </p>
                </div>
              </details>
            );
          })}
        </div>
      )}
      <div className="pagination">
        <button
          className="secondary-button"
          disabled={page === 0 || resource.loading}
          onClick={() => setPage((value) => value - 1)}
        >
          上一页
        </button>
        <span>第 {page + 1} 页</span>
        <button
          className="secondary-button"
          disabled={
            resource.loading || !!resource.error || !resource.data?.hasMore
          }
          onClick={() => setPage((value) => value + 1)}
        >
          下一页
        </button>
      </div>
    </>
  );
}
