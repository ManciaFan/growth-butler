import type { Metadata } from "next";
import { GoalsDashboard } from "@/components/goals-dashboard";
export const metadata: Metadata = { title: "目标" };
export default function GoalsPage() {
  return <GoalsDashboard />;
}
