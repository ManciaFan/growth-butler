import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, ArrowRight } from "lucide-react";
export const metadata: Metadata = { title: "历史" };
export default function HistoryPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">EVERY STEP LEAVES A TRACE</p>
          <h1>回头看看，走过的路</h1>
          <p>记录日常，也看见那些微小的变化。</p>
        </div>
      </div>
      <section className="card empty-state">
        <span className="empty-icon">
          <BookOpen size={38} />
        </span>
        <span className="tag">成长记录</span>
        <h2>你的故事，从今天开始</h2>
        <p>
          还没有保存的成长记录。
          <br />
          后续接入数据存储后，可以在这里回顾每日计划与反馈。
        </p>
        <Link href="/" className="primary-button">
          回到今天 <ArrowRight size={17} />
        </Link>
      </section>
    </>
  );
}
