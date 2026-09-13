import { createClient } from "@/lib/supabase/client";
import { getSupabaseConfig } from "@/lib/supabase/config";
import {
  dateWindow,
  validatePreview,
  validateProposal,
  type PlanPreview,
} from "../../supabase/functions/_shared/plan-schema";
export type { PlanPreview } from "../../supabase/functions/_shared/plan-schema";
const errors: Record<string, string> = {
  UNAUTHENTICATED: "登录已失效，请重新登录后再试。",
  AUTH_UNAVAILABLE: "暂时无法验证登录状态，请稍后重试。",
  INVALID_REQUEST: "请求格式不正确，请刷新页面后重试。",
  DATE_CHANGED: "日期已经变化，请刷新首页后重新生成。",
  PLAN_EXISTS: "明天已经有计划，本次没有覆盖或重复添加任务。",
  TODAY_MISSING: "尚未找到今天的计划，请先刷新首页。",
  DATABASE_ERROR:
    "数据库操作失败，尚未确认保存成功。请检查数据库配置或网络后重试。",
  CONTEXT_TOO_LARGE: "近期记录超出本次分析上限，请精简活跃目标或记录内容。",
  AI_CONFIG_ERROR:
    "AI 服务配置或凭据不可用，请检查 Supabase Edge Function Secrets。",
  AI_TIMEOUT: "AI 分析超时，请稍后重试。",
  AI_RATE_LIMIT: "AI 请求过于频繁，请稍后再试。",
  AI_QUOTA: "DeepSeek 余额不足，请在 DeepSeek 平台检查余额。",
  AI_UNAVAILABLE: "AI 服务暂时不可用，请稍后重试。",
  AI_INVALID_RESPONSE: "AI 结果未通过校验，请重新生成计划。",
  NETWORK_ERROR: "网络连接失败，尚未收到结果。请检查网络后重试。",
  NOT_DEPLOYED:
    "AI 函数尚未部署或地址不可用，请先部署 generate-tomorrow-plan。",
  MIGRATION_REQUIRED:
    "数据库尚未完成第三阶段升级，请先执行 002_ai_tomorrow_plan.sql。",
};
function failure(code: string) {
  return new Error(Object.hasOwn(errors, code) ? errors[code] : errors.AI_UNAVAILABLE);
}
export async function generateTomorrowPlan(
  sourceDate: string,
): Promise<PlanPreview> {
  if (sourceDate !== dateWindow().today) throw failure("DATE_CHANGED");
  const db = createClient();
  const {
    data: { session },
    error,
  } = await db.auth.getSession();
  if (error || !session) throw failure("UNAUTHENTICATED");
  const { url, publishableKey } = getSupabaseConfig();
  let response: Response;
  try {
    response = await fetch(
      `${url.replace(/\/+$/, "")}/functions/v1/generate-tomorrow-plan`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: publishableKey,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ source_date: sourceDate }),
        signal: AbortSignal.timeout(95000),
      },
    );
  } catch (cause) {
    throw failure(
      cause instanceof Error &&
        ["TimeoutError", "AbortError"].includes(cause.name)
        ? "AI_TIMEOUT"
        : "NETWORK_ERROR",
    );
  }
  if (response.status === 401) throw failure("UNAUTHENTICATED");
  if (response.status === 404) throw failure("NOT_DEPLOYED");
  let value;
  try {
    value = await response.json();
  } catch (cause) {
    throw failure(
      cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name) ? "AI_TIMEOUT" : response.status === 429 ? "AI_RATE_LIMIT" : "AI_INVALID_RESPONSE",
    );
  }
  if (!response.ok)
    throw failure(
      response.status === 401
        ? "UNAUTHENTICATED"
        : response.status === 404
          ? "NOT_DEPLOYED"
          : typeof value?.code === "string"
            ? value.code
            : response.status === 429 ? "AI_RATE_LIMIT" : response.status === 402 ? "AI_QUOTA" : response.status === 504 ? "AI_TIMEOUT" : "AI_UNAVAILABLE",
    );
  let preview;
  try {
    preview = validatePreview(value);
  } catch {
    throw failure("AI_INVALID_RESPONSE");
  }
  const dates = dateWindow();
  if (
    preview.source_date !== dates.today ||
    preview.plan_date !== dates.tomorrow ||
    preview.source_date !== sourceDate
  )
    throw failure("DATE_CHANGED");
  return preview;
}
export async function adoptTomorrowPlan(preview: PlanPreview, planId: string) {
  const dates = dateWindow();
  if (
    preview.source_date !== dates.today ||
    preview.plan_date !== dates.tomorrow
  )
    throw failure("DATE_CHANGED");
  try { validateProposal(preview.proposal); } catch { throw failure("AI_INVALID_RESPONSE"); }
  const { data, error } = await Promise.resolve(createClient().rpc("adopt_tomorrow_plan", {
    p_source_date: preview.source_date,
    p_proposal: preview.proposal,
    p_plan_id: planId,
  })).catch(() => { throw failure("DATABASE_ERROR"); });
  if (error) {
    if (["PT401", "PGRST301", "PGRST303"].includes(error.code))
      throw failure("UNAUTHENTICATED");
    if (["PT409", "23505"].includes(error.code)) throw failure("PLAN_EXISTS");
    if (error.code === "PT410") throw failure("DATE_CHANGED");
    if (error.code === "PT422") throw failure("AI_INVALID_RESPONSE");
    if (["PGRST202", "42883", "42703"].includes(error.code))
      throw failure("MIGRATION_REQUIRED");
    throw failure("DATABASE_ERROR");
  }
  if (data !== planId) throw failure("DATABASE_ERROR");
  return data;
}
