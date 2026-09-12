"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="card">
      <h1>暂时无法加载</h1>
      <p role="alert">请检查网络连接或 Supabase 配置，然后重试。</p>
      <button className="primary-button" onClick={reset}>
        重新加载
      </button>
    </section>
  );
}
