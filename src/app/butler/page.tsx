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
        <span className="outline-chip">即将到来</span>
      </div>
      <section className="hero butler-hero">
        <div>
          <span className="hero-label">
            <Sparkles size={17} /> 你的成长管家
          </span>
          <h2>一起，把日子过成喜欢的样子。</h2>
          <p>
            未来，这里将陪你梳理计划、拆解目标、回顾成长。
            <br />
            当前尚未开通智能对话，可以先从今天的计划开始。
          </p>
          <Link href="/" className="hero-link">
            看看今日计划 <ArrowRight size={17} />
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
            <span className="tag">后续开放</span>
          </section>
        ))}
      </div>
    </>
  );
}
