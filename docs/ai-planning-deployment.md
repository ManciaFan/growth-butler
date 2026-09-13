# 第三阶段：AI 明日计划部署

代码推送到 main 会触发已连接的 Vercel 部署；Supabase SQL 和 Edge Function 需要分别部署。以下操作针对已完成第二阶段的现有项目，不需要提供或重新创建 DeepSeek Key。

## 1. 在当前项目执行增量 SQL

在 Supabase Dashboard 核对项目 URL 与 Vercel 的 `NEXT_PUBLIC_SUPABASE_URL` 一致。进入 **SQL Editor → New query**，完整复制仓库 `supabase/migrations/002_ai_tomorrow_plan.sql`，以默认 postgres 身份执行一次。

不要重复执行 001，也不要删表或关闭 RLS。002 会增加任务的 `reason` 和 `success_criteria` 字段，并创建 `adopt_tomorrow_plan` 函数。函数使用 **SECURITY INVOKER**，继承登录用户权限和现有 RLS；计划与所有任务在同一个事务中保存。数据库仍保留每用户每天唯一约束，已有明日计划时返回冲突，不覆盖内容。

执行后检查 **Database → Functions** 中存在 `adopt_tomorrow_plan`，执行权限仅授予 authenticated；四张业务表 RLS 仍开启。

## 2. 检查现有 Secrets

在 **Edge Functions → Secrets** 确认当前项目存在这三个名称：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`：仅支持 `https://api.deepseek.com` 或 `https://api.deepseek.com/v1`，可带末尾斜杠。
- `DEEPSEEK_MODEL`：填写账号当前可用、支持 Chat Completions JSON 模式及关闭 thinking 的模型名称。

无需将这些值添加到 Vercel、`.env.example`、浏览器或数据库。函数从平台获得 Supabase URL 和公开 API Key，并使用请求中的用户 JWT 查询数据库；不使用 service_role。现有 Secrets 正确时无需修改。

## 3. 部署 Edge Function

在已拉取最新 main 的仓库根目录执行（需要 Node.js 和 Supabase 账号登录）：

```bash
npx supabase@latest login
npx supabase@latest projects list
npx supabase@latest functions deploy generate-tomorrow-plan --project-ref YOUR_PROJECT_REF --use-api
```

把 `YOUR_PROJECT_REF` 替换为当前项目的 Reference ID，可在 Dashboard 项目设置找到；普通项目 URL 为 `https://YOUR_PROJECT_REF.supabase.co`。不要选择另一个项目。`--use-api` 使用服务端打包，不要求本机 Docker；部署流程参见 [Supabase 官方说明](https://supabase.com/docs/guides/functions/quickstart)。

仓库 `supabase/config.toml` 已设置此函数 `verify_jwt = false`，兼容 Publishable Key 和新 JWT 签名方式。Dashboard 中此函数的 **Verify JWT / Enforce JWT verification** 应保持关闭。**函数本身会先调用 Supabase Auth `getUser(jwt)` 验证登录状态**，拒绝缺失、无效 JWT 和匿名用户，然后才读取数据或调用 AI。不要删除这段验证代码。网关开关并不代替函数内身份验证。

函数入口为 `supabase/functions/generate-tomorrow-plan/index.ts`；CLI 会同时打包其共享校验文件与依赖配置。部署后在 Dashboard 的 Edge Functions 列表确认该函数存在。无需新增定时任务、数据库触发 AI 的逻辑或额外 Vercel 环境变量。

## 4. 上线验收

1. 确认 Vercel main 的最新部署成功，然后登录网站。
2. 保存今日目标、任务完成状态和今日反馈；临时高优先级事件可以明确写在反馈里。
3. 点击“结束今天，生成明日计划”，检查总结、调整原因、唯一主目标、最多三项任务、时间与完成标准。此时数据库不应出现新明日计划。
4. 点击取消，确认没有写入；重新生成会产生一次新的模型请求。
5. 点击“采用此计划”，仅看到明确成功提示后才算保存；在 Dashboard 核对明天计划和任务。用另一设备同账号刷新核对云数据（明日计划在明天首页展示，过期后进入历史）。
6. 再次生成或另一设备采用不同预览时，应提示明天已有计划，不能覆盖或增加重复任务。
7. 退出登录或断网时操作应报错；第二个账号看不到第一个账号的数据。

本地已提供模拟 AI/网络测试与 PGlite 数据库测试；实际 DeepSeek 额度、项目 Secrets、云函数部署和真实账号端到端连通性需以上线验收确认。

## 行为和限制

- 日期统一北京时间；跨午夜的预览不能采用，需要刷新。页面有未保存修改时先保存；已保存的今日内容发生变化后需要重新生成预览。
- 生成阶段只读数据；采用阶段调用数据库事务。相同预览重试复用 UUID，响应丢失后再次采用不会创建重复任务。
- 只读取进行中目标、当天反馈以及含今天的最近 7 天计划与任务。不读取更早历史，也不将用户 ID/记录 ID 发给模型。
- 为控制输入成本，最多读取 20 个进行中目标、200 个近七天任务，输入不超过 24,000 字符；超限会明确报错，不静默截断。
- 每次生成正常只调用一次模型；仅格式/结构/规划规则错误重试一次。单次模型请求超时 30 秒，最大输出 1,800 tokens，关闭 thinking。不自动重试网络、限流、余额或配置错误。
- 连续最近三个有统计的日计划完成率低于 50% 时，限制到最多两个任务、每个最多 30 分钟。允许零任务的休息日。已完成同名任务会被服务端拒绝；语义改写仍需用户在预览中判断。
- AI 总结和调整原因仅用于预览；采用后保存明日主目标、任务、预计时长、安排原因和完成标准。
- 错误提示区分未登录、超时、限流、余额不足、JSON 错误、配置错误、数据库失败和计划冲突；不要将等待结束或界面草稿当作成功。
