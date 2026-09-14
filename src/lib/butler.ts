import { createClient } from "./supabase/client";
import { getSupabaseConfig } from "./supabase/config";
import {
  validateChat,
  type MemoryProposal,
} from "../../supabase/functions/_shared/chat-schema";
import type { PlanPreview } from "./ai-plan";
export { validateChat } from "../../supabase/functions/_shared/chat-schema";
export const dbFailure = (error?: { code?: string } | null) =>
  new Error(
    error?.code === "PT409"
      ? "记忆已在其他页面改变，请刷新后确认。"
      : error?.code === "PGRST202" || error?.code === "42P01"
        ? "请先执行第四阶段数据库迁移 003。"
        : "云端操作失败，未确认保存成功，请检查网络后重试。",
  );
export async function sendChat(
  sessionId: string,
  id: string,
  content: string,
  preview: PlanPreview | null,
) {
  const {
    data: { session },
    error,
  } = await createClient().auth.getSession();
  if (error || !session) throw new Error("登录已失效，请重新登录。");
  const config = getSupabaseConfig();
  try {
    const response = await fetch(`${config.url}/functions/v1/butler-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.publishableKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        message_id: id,
        content,
        preview,
      }),
      signal: AbortSignal.timeout(95000),
    });
    if (response.status === 401) throw new Error("登录已失效，请重新登录。");
    if (response.status === 404)
      throw new Error("请先部署 butler-chat 云函数。");
    const value = await response.json();
    if (!response.ok) {
      const errors: Record<string, string> = {
        COURSE_TIME_MISSING: "今天课程缺少具体时间，请先到课表补齐节次时间。",
        REPLANNING_NOT_READY: "今日调整尚未启用，请先执行 005 数据库迁移。",
        TODAY_MISSING: "请先打开首页创建今天的计划，再回来调整。",
        TURN_BUSY: "这条消息正在处理，请稍后刷新后重试。",
        AI_TIMEOUT: "AI 回复超时，可以重试该消息。",
        AI_RATE_LIMIT: "请求过于频繁，请稍后重试。",
        AI_QUOTA: "DeepSeek 余额不足。",
        AI_CONFIG_ERROR: "AI 配置不可用，请检查云函数 Secrets。",
        AI_INVALID_RESPONSE: "AI 回复格式未通过校验，请重试。",
        CONTEXT_TOO_LARGE: "当前有效信息过多，请整理长期记忆或目标后重试。",
        DATABASE_ERROR: "聊天云端读写失败，请检查网络与 003 数据库迁移。",
      };
      throw new Error(
        Object.hasOwn(errors, value.code)
          ? errors[value.code]
          : "管家暂时无法回复，请稍后重试。",
      );
    }
    return validateChat(value, content);
  } catch (error) {
    if (error instanceof TypeError)
      throw new Error("网络连接失败，请重试；已保存的消息会保留。");
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    )
      throw new Error("等待超时，请先刷新聊天检查回复，再重试该消息。");
    throw error;
  }
}
export async function confirmMemory(
  proposal: MemoryProposal,
  previous: string | null,
  source: string | null,
  id: string,
) {
  const { data, error } = await createClient().rpc("confirm_memory", {
    p_id: id,
    p_category: proposal.category,
    p_key: proposal.key,
    p_value: proposal.value,
    p_confidence: proposal.confidence,
    p_source: source,
    p_previous: previous,
    p_action: proposal.action,
  });
  if (error || data !== id) throw dbFailure(error);
}
// Manual summary interface. No model call, scheduler, or deletion of source records.
// Summaries are historical interpretations; active memories always take precedence.
export async function savePeriodSummary(
  userId: string,
  start: string,
  end: string,
  summary: string,
  id: string,
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
    start > end ||
    !summary.trim() ||
    summary.length > 12000
  )
    throw new Error("请检查摘要日期和内容。");
  const { error } = await createClient()
    .from("period_summaries")
    .insert({
      id,
      user_id: userId,
      period_start: start,
      period_end: end,
      summary,
    })
    .select("id")
    .single();
  if (error) throw dbFailure(error);
}
