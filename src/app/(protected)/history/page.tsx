import type { Metadata } from "next";
import { HistoryDashboard } from "@/components/history-dashboard";
export const metadata: Metadata = { title: "历史" };
export default function HistoryPage() {
  return <HistoryDashboard />;
}
