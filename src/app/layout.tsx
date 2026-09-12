import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "今日 · 成长管家", template: "%s · 成长管家" },
  description: "让每一天的小行动，成为更好的自己。个人计划、目标与成长记录。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
