export const messages = {
  UNAUTHENTICATED: "登录已失效，请重新登录后生成计划。",
  AUTH_UNAVAILABLE: "暂时无法验证登录状态，请稍后重试。",
  INVALID_REQUEST: "请求格式不正确，请刷新页面后重试。",
  DATE_CHANGED: "日期已经变化，请刷新首页后重新生成计划。",
  PLAN_EXISTS: "明天已经有计划，本次没有覆盖或添加任务。",
  TODAY_MISSING: "尚未找到今天的计划，请先刷新首页。",
  DATABASE_ERROR: "读取数据库失败，请检查网络和数据库配置后重试。",
  CONTEXT_TOO_LARGE:
    "近期记录超出本次分析上限，请精简活跃目标或记录内容后再试。",
  AI_CONFIG_ERROR: "AI 服务配置或凭据不可用，请检查 Edge Function Secrets。",
  AI_TIMEOUT: "AI 分析超时，请稍后重试。",
  AI_RATE_LIMIT: "AI 服务请求过于频繁，请稍后再试。",
  AI_QUOTA: "AI 服务余额不足，请在 DeepSeek 平台检查余额。",
  AI_UNAVAILABLE: "AI 服务暂时不可用，请稍后重试。",
  AI_INVALID_RESPONSE: "AI 返回的计划未通过格式或规划规则校验，请重新生成。",
} as const;
export type ErrorCode = keyof typeof messages;
export class PlanError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  constructor(code: ErrorCode, status: number) {
    super(messages[code]);
    this.code = code;
    this.status = status;
  }
}
