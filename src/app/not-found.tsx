import Link from "next/link";
export default function NotFound() {
  return (
    <section className="card empty-state">
      <p className="eyebrow">404</p>
      <h1>这一页还没有留下足迹</h1>
      <p>回到今天，继续你的成长旅程。</p>
      <Link href="/" className="primary-button">
        返回首页
      </Link>
    </section>
  );
}
