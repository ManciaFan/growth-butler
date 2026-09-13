# 第四阶段：对话与可纠正记忆

目标项目：`wtofvklcjtybapxjqxpu`。本次只提交代码和增量 SQL，**不自动执行生产迁移**。先由你审阅并执行 003，再部署函数。001 和 002 保持原样。

## Dashboard 手动步骤

1. 打开当前 Supabase 项目 **SQL Editor → New query**，复制 `supabase/migrations/003_butler_chat_memory.sql` 的完整内容，审阅后以默认 postgres 身份执行一次。不要重新执行 001/002，不要删表或关闭 RLS。
2. 检查新增 `chat_sessions`、`chat_messages`、`memories`、`period_summaries` 四张表的 RLS 均开启，每张表具备 authenticated 的 SELECT/INSERT/UPDATE/DELETE 所有者策略。跨表外键同时校验记录 ID 和 user_id。
3. 检查 `confirm_memory`、`claim_chat_turn` 两个 RPC 为 SECURITY INVOKER，执行权限仅授予 authenticated。确认 `memories_one_active` 唯一索引存在。
4. **Edge Functions → Secrets** 保持现有 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`，无需新增、修改或提供密钥。前端仍只用现有 Supabase URL 和 Publishable Key。
5. 执行下列部署命令后，在 Edge Functions 列表确认两个函数存在。两者网关 **Verify JWT** 保持关闭（仓库配置），函数代码在任何数据/AI 操作前使用 `auth.getUser(jwt)` 验证登录，拒绝缺失/无效 JWT 和匿名账号。
6. 确认 GitHub main 对应的 Vercel 部署成功，登录网站验收。

## 部署命令

从最新 main 的仓库根目录执行。如果 CLI 已登录，可以跳过第一行；需要授权时在浏览器完成，不把 Access Token 发给别人。

```bash
npx supabase@latest login
npx supabase@latest functions deploy butler-chat --project-ref wtofvklcjtybapxjqxpu --use-api
npx supabase@latest functions deploy generate-tomorrow-plan --project-ref wtofvklcjtybapxjqxpu --use-api
```

必须在执行 003 后再部署这两个版本：明日规划也新增了有效记忆读取。GitHub push 仅触发 Vercel，不会自动部署 Supabase 函数。

函数地址：

- `https://wtofvklcjtybapxjqxpu.supabase.co/functions/v1/butler-chat`
- `https://wtofvklcjtybapxjqxpu.supabase.co/functions/v1/generate-tomorrow-plan`

## 使用与验收

- `/butler` 支持新建/切换对话、刷新云端记录、读取更早消息。消息云端保存；没有聊天轮数限制或后台轮询。
- 输入“以后每天可投入三小时”，AI 可以提出长期信息，但确认之前 `memories` 不新增 active 记录。“更新记忆”才调用确认 RPC；“仅本次使用”和“不要记”仅记录本次选择。
- 输入“这句话不要记”时，服务端会清除本轮记忆建议。临时事件由提示词约束为本次信息；模型理解有歧义时应先询问，用户也可直接拒绝建议。
- “管家记忆”支持查看有效值、类别、更新时间，编辑、失效、删除，以及查看历史。编辑会把旧版本设为 superseded，并在同一事务创建 active 新版本；失败全部回滚。失效后不参与规划。相同 category/key 只能有一个 active 版本，陈旧确认会报冲突。
- 记忆修正不会改写原聊天，也不会自动修改 goals 表；长期目标需要在“目标”页面编辑。记忆类别和字段含义由 AI 提议，确认前请检查是否确实对应你要改的长期信息。
- 首页生成预览后点击“和管家聊聊”，可解释或调整预览。“应用这次调整到预览”不写计划表，最终仍需“采用此计划”。预览改变后不能直接应用旧预览的调整建议。讨论区直接放在预览旁，方便核对。
- 用两个账号验证聊天、记忆、摘要相互隔离；用两个设备同账号刷新验证同步。测试断网、重复提交、余额不足和超时，页面不能显示虚假成功。

## 上下文与成本

每轮聊天读取当前有效记忆（最多 100 条、18,000 字符）、active goals、含今天最近 7 天计划/任务完成情况及当天反馈、当前会话最近 40 条消息、最近 2 份阶段摘要，以及显式传入的当前预览。模型输入中不包含记录所有者 ID，过期记忆值不读取。

最近聊天先做**摘录式压缩**：最近 8 条每条最多 1,000 字符，更早部分每条提取 120 字符，总预算约 10,000 字符。当前用户消息单独完整传入，最多 4,000 字符；每份历史阶段摘要截取 2,000 字符，并仅作为历史参考，有效记忆优先。原始消息和摘要不被截断或删除。上下文总量上限 60,000 字符；已压缩聊天后仍超限时返回明确错误，不限制用户累计轮数。

模型一次正常请求，格式或规则不合格最多重试一次；没有网络自动重试。每次请求 30 秒超时、1,800 输出 tokens、关闭 thinking。失败的用户消息保留并可重试，已保存的回复重用而不再次调用模型。同一消息处理中拒绝重复请求，异常处理中断的占用三分钟后可重试。

AI JSON 经过严格字段/类型校验，计划调整复用现有计划 schema 与已完成任务、低完成率减量规则。用户数据不能覆盖系统规则，没有 AI 数据库写入工具；新增 Edge Function 只写聊天记录，不调用记忆确认或计划采用 RPC。代码不记录请求体、JWT、Key 或 provider 原始响应。

## 阶段摘要接口（预留）

`period_summaries` 保存按日期区间的历史压缩层；`src/lib/butler.ts` 的 `savePeriodSummary(userId, start, end, summary, id)` 提供经过登录用户 RLS 的手动写入接口。相同区间重复保存报错，不假装覆盖成功。

本阶段没有自动 Cron，也没有自动 AI 月度总结。未来人工或模型生成摘要时应包含最终有效结论、方向变化、已纠正结论及其失效说明；active memories 始终优先，不将摘要当成永久事实，不删除底层记录。

## 本地检查

```bash
npm run test:db
npm run test:ai
npm run lint
npm run build
npx --yes --package=deno deno check --config supabase/functions/butler-chat/deno.json supabase/functions/butler-chat/index.ts supabase/functions/generate-tomorrow-plan/index.ts
```

测试使用 PGlite 真实 SQL 和模拟模型/网络，不连接生产数据库，不消耗 DeepSeek 余额。真实云端连通性需完成上述部署后验收。
