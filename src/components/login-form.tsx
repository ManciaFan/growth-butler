"use client";
import { useState } from "react";
import { Leaf } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ initialError = "" }: { initialError?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initialError);
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const { error } = await createClient().auth.signInWithPassword({
        email: String(fields.get("email")).trim(),
        password: String(fields.get("password")),
      });
      if (error) throw error;
      const next = new URLSearchParams(window.location.search).get("next");
      // Only allow known internal destinations; use a full navigation to clear cached user data.
      window.location.assign(
        next && ["/", "/goals", "/history", "/butler"].includes(next)
          ? next
          : "/",
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(
        message.includes("Invalid login")
          ? "邮箱或密码不正确，请重试。"
          : message.includes("Email not confirmed")
            ? "邮箱尚未确认，请先确认邮箱或联系管理员。"
            : message.includes("尚未配置")
              ? message
              : "登录失败。请检查网络、账号状态和 Supabase 配置后重试。",
      );
      setPending(false);
    }
  }
  return (
    <main className="login-page">
      <section className="card login-card">
        <span className="brand-icon">
          <Leaf size={28} />
        </span>
        <p className="eyebrow">GROWTH BUTLER</p>
        <h1>欢迎回到成长管家</h1>
        <p className="muted">登录你的账号，在不同设备继续今天的成长。</p>
        <form className="stack-form" onSubmit={login}>
          <label>
            邮箱
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              disabled={pending}
            />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              disabled={pending}
            />
          </label>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={pending}>
            {pending ? "正在登录……" : "登录"}
          </button>
        </form>
        <p className="card-footnote">
          账号由管理员在 Supabase 中创建。忘记密码时请联系管理员重设。
        </p>
        <p className="card-footnote">
          若登录后仍返回此页，请检查网络连接和账号会话，再重试。
        </p>
      </section>
    </main>
  );
}
