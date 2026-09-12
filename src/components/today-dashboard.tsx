"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Clock3, Leaf, Sun, Target } from "lucide-react";
import { initialTasks } from "@/lib/demo-data";
export function TodayDashboard() {
  const [tasks, setTasks] = useState(initialTasks);
  const [mood, setMood] = useState("还不错");
  const [feedback, setFeedback] = useState("");
  const [saved, setSaved] = useState(false);
  const completed = tasks.filter((task) => task.done).length;
  const percent = Math.round((completed / tasks.length) * 100);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">A LITTLE BETTER, EVERY DAY</p>
          <h1>
            今天，也向前一点点 <Sun className="sun" size={30} />
          </h1>
          <p>不用一下子变得很厉害，先做好今天的小事。</p>
        </div>
        <span className="outline-chip">我的每日成长板</span>
      </div>
      <section className="hero">
        <div>
          <span className="hero-label">
            <Leaf size={16} /> 今日寄语
          </span>
          <h2>把注意力，放回自己身上。</h2>
          <p>认真生活的每一天，都在悄悄为未来积蓄力量。</p>
          <a href="#today-plan" className="hero-link">
            从一个小行动开始 <ArrowRight size={17} />
          </a>
        </div>
        <div className="plant-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="plant-leaf leaf-one" />
          <span className="plant-leaf leaf-two" />
          <span className="plant-leaf leaf-three" />
          <span className="plant-stem" />
          <span className="plant-pot" />
          <span className="plant-caption">KEEP GROWING</span>
        </div>
      </section>
      <div className="dashboard-grid">
        <div className="main-column">
          <section className="card" id="today-plan">
            <div className="section-heading">
              <h2>
                今日计划 <span className="count">{tasks.length}</span>
              </h2>
              <span className="muted small">为重要的事，留出时间</span>
            </div>
            <div className="task-list">
              {tasks.map((task) => (
                <label
                  key={task.id}
                  className={`task-row ${task.done ? "done" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={task.done}
                    onChange={() =>
                      setTasks((current) =>
                        current.map((item) =>
                          item.id === task.id
                            ? { ...item, done: !item.done }
                            : item,
                        ),
                      )
                    }
                  />
                  <span className="check-box" aria-hidden="true">
                    {task.done && <Check size={15} />}
                  </span>
                  <span className="task-content">
                    <strong>{task.title}</strong>
                    <span>
                      <span className="task-tag">{task.category}</span>
                      <Clock3 size={12} /> {task.duration}
                    </span>
                  </span>
                  <span className="task-time">{task.time}</span>
                </label>
              ))}
            </div>
            <p className="card-footnote">
              示例计划，可勾选体验；更改仅保留在当前页面。
            </p>
          </section>
          <section className="card feedback">
            <div className="section-heading">
              <h2>今日反馈</h2>
              <span className="muted small">给今天的自己，一个回应</span>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setSaved(true);
              }}
            >
              <fieldset>
                <legend>今天的状态怎么样？</legend>
                <div className="mood-list">
                  {["有点累", "平平淡淡", "还不错", "能量满满"].map(
                    (item, index) => (
                      <button
                        className={`mood ${mood === item ? "selected" : ""}`}
                        type="button"
                        aria-pressed={mood === item}
                        key={item}
                        onClick={() => {
                          setMood(item);
                          setSaved(false);
                        }}
                      >
                        <span aria-hidden="true">
                          {["☁", "◡", "☺", "☀"][index]}
                        </span>
                        {item}
                      </button>
                    ),
                  )}
                </div>
              </fieldset>
              <label className="sr-only" htmlFor="reflection">
                今天的收获或感受
              </label>
              <textarea
                id="reflection"
                maxLength={1000}
                value={feedback}
                onChange={(event) => {
                  setFeedback(event.target.value);
                  setSaved(false);
                }}
                placeholder="今天有什么小收获？也可以写下此刻的感受……"
              />
              <div className="feedback-bottom">
                <p role="status">
                  {saved
                    ? "已记录本次演示反馈，离开或刷新页面后重置。"
                    : "只在当前页面记录，尚未保存到云端。"}
                </p>
                <button className="primary-button" type="submit">
                  记录今天 <ArrowRight size={16} />
                </button>
              </div>
            </form>
          </section>
        </div>
        <div className="side-column">
          <section className="card progress-card">
            <div className="section-heading">
              <h2>任务完成进度</h2>
              <span className="mini-icon">
                <Target size={18} />
              </span>
            </div>
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
              已完成 <strong>{completed}</strong> / {tasks.length} 项计划
            </p>
            <p className="encouragement">
              {percent === 100
                ? "今天的计划完成啦，为自己点个赞！"
                : "每完成一件小事，都是一次前进。"}
            </p>
          </section>
          <section className="card daily-goal">
            <div className="section-heading">
              <h2>今日目标</h2>
              <span className="mini-icon">
                <Leaf size={18} />
              </span>
            </div>
            <span className="tag">专注自己</span>
            <h3>留出一段不被打扰的时间</h3>
            <p>
              放下手机，专注 45 分钟。
              <br />
              完成比完美更重要。
            </p>
            <Link href="/goals" className="text-link">
              看看我的长期目标 <ArrowRight size={16} />
            </Link>
          </section>
          <div className="quote">
            <span>“</span>
            <p>
              成长不是每天都更好，
              <br />
              而是愿意每天再试一次。
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
