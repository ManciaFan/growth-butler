import type { Metadata } from "next";
import Link from "next/link";
import {
  Sparkles,
  CalendarDays,
  Flag,
  BookOpen,
  ArrowRight,
} from "lucide-react";
export const metadata: Metadata = { title: "管家" };
export default function ButlerPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR SPACE TO GROW</p>
          <h1>成长路上，给自己一点陪伴</h1>
          <p>整理思绪，找到下一步的方向。</p>
        </div>
        <span className="outline-chip">明日规划已开放</span>
      </div>
      <section className="hero butler-hero">
        <div>
          <span className="hero-label">
            <Sparkles size={17} /> 你的成长管家
          </span>
          <h2>一起，把日子过成喜欢的样子。</h2>
          <p>
            保存今天的反馈，让管家根据你的目标与近期完成情况梳理明天。
            <br />
            先看 AI 建议，再决定是否采用。每一步都由你确认。
          </p>
          <Link href="/" className="hero-link">
            去首页生成明日计划 <ArrowRight size={17} />
          </Link>
        </div>
      </section>
      <div className="goal-grid">
        {[
          {
            icon: CalendarDays,
            title: "梳理一天",
            text: "让每一天的安排，更贴近自己的节奏。",
          },
          {
            icon: Flag,
            title: "拆解目标",
            text: "把一个遥远的愿望，变成眼前的小行动。",
          },
          {
            icon: BookOpen,
            title: "回顾成长",
            text: "从日常的记录里，看见变化与收获。",
          },
        ].map(({ icon: Icon, title, text }) => (
          <section className="card" key={title}>
            <span className="goal-icon">
              <Icon size={24} />
            </span>
            <h2>{title}</h2>
            <p className="muted">{text}</p>
            <span className="tag">明日规划的一部分</span>
          </section>
        ))}
      </div>
    </>
  );
}
