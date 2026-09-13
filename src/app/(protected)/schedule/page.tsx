import type { Metadata } from "next";
import { ScheduleManager } from "@/components/schedule-manager";
export const metadata: Metadata = { title: "课表" };
export default function SchedulePage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE ROOM FOR YOUR DAY</p>
          <h1>给课程留好时间</h1>
          <p>课表保存在这里，管家需要时会读取相关日期。</p>
        </div>
      </div>
      <ScheduleManager />
    </>
  );
}
