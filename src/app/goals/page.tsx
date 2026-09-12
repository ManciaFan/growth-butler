import type { Metadata } from "next";
import { Flag } from "lucide-react";
import { goals } from "@/lib/demo-data";
export const metadata: Metadata = { title: "目标" };
export default function GoalsPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE ROOM FOR WHAT MATTERS</p>
          <h1>目标，让努力有方向</h1>
          <p>把想成为的样子，拆成可以走的小步。</p>
        </div>
        <span className="outline-chip">示例目标</span>
      </div>
      <div className="goal-grid">
        {goals.map((goal) => (
          <section className={`card goal-card ${goal.color}`} key={goal.title}>
            <span className="goal-icon">
              <Flag size={23} />
            </span>
            <span className="tag">{goal.category}</span>
            <h2>{goal.title}</h2>
            <p>{goal.description}</p>
            <div className="goal-progress-label">
              <span>当前进度</span>
              <strong>
                {goal.value} / {goal.total} {goal.unit}
              </strong>
            </div>
            <progress
              aria-label={goal.title}
              value={goal.value}
              max={goal.total}
            />
          </section>
        ))}
      </div>
      <div className="empty-note">
        <h2>让目标慢慢生根</h2>
        <p>
          这里先展示目标卡片的样子。目标创建、编辑和云端保存将在后续阶段开放。
        </p>
      </div>
    </>
  );
}
