import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
export const metadata: Metadata = { title: "登录" };
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <LoginForm
      initialError={
        reason === "unavailable"
          ? "暂时无法验证登录状态，请检查网络和 Supabase 环境配置后重试。"
          : ""
      }
    />
  );
}
