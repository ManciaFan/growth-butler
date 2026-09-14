import { validateProposal, type PlanProposal } from "./plan-schema.ts";
import { validateToday, type TodayRevision } from "./today-schema.ts";
export type MemoryProposal = {
  category: string;
  key: string;
  value: string;
  confidence: "low" | "medium" | "high";
  action: "replace" | "invalidate";
};
export type ChatReply = {
  reply: string;
  memory_proposal: MemoryProposal | null;
  plan_revision: PlanProposal | null;
  today_revision?: TodayRevision | null;
};
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== keys.sort().join()
  )
    throw new Error("Invalid object");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("Invalid text");
  return value.trim();
}
export function validateMemory(value: unknown): MemoryProposal {
  const v = object(value, ["category", "key", "value", "confidence", "action"]);
  if (
    !["low", "medium", "high"].includes(String(v.confidence)) ||
    !["replace", "invalidate"].includes(String(v.action))
  )
    throw new Error("Invalid memory");
  return {
    category: text(v.category, 80),
    key: text(v.key, 120),
    value: text(v.value, 1200),
    confidence: v.confidence as MemoryProposal["confidence"],
    action: v.action as MemoryProposal["action"],
  };
}
export function doNotRemember(text: string) {
  return /不要.{0,8}(记|保存)|别.{0,4}记|不.{0,3}(进入|加入|存入).{0,3}记忆|仅本次|只.{0,3}这次|do not remember|don't remember/i.test(
    text,
  );
}
export function validateChat(value: unknown, input = ""): ChatReply {
  const hasToday =
    !!value && typeof value === "object" && "today_revision" in value;
  const v = object(value, [
    "reply",
    "memory_proposal",
    "plan_revision",
    ...(hasToday ? ["today_revision"] : []),
  ]);
  return {
    ...(hasToday
      ? {
          today_revision:
            v.today_revision === null ? null : validateToday(v.today_revision),
        }
      : {}),
    reply: text(v.reply, 6000),
    memory_proposal: doNotRemember(input)
      ? null
      : v.memory_proposal === null
        ? null
        : validateMemory(v.memory_proposal),
    plan_revision:
      v.plan_revision === null ? null : validateProposal(v.plan_revision),
  };
}
// Extractive compression, not a factual memory. Raw messages remain unchanged in PostgreSQL.
export function compressChat(
  messages: { role: string; content: string }[],
  budget = 10000,
) {
  const latest = messages.slice(-8);
  const older = messages.slice(0, -8);
  const recent = latest.map((m) => ({
    role: m.role,
    content: m.content.slice(0, 1000),
  }));
  const excerpts = older
    .map((m) => `${m.role}: ${m.content.slice(0, 120)}`)
    .join("\n");
  return {
    older_excerpts: excerpts.slice(
      0,
      Math.max(0, budget - JSON.stringify(recent).length - 100),
    ),
    recent,
    notice:
      "历史摘录可能已被纠正，不是当前事实；active memories 优先。缺失信息请询问，不要推断。",
  };
}
