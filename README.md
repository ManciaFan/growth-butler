# 成长管家 · Growth Butler

Next.js App Router + TypeScript + Supabase Auth/PostgreSQL，部署于 Vercel 的个人成长 Web App。

## 第二阶段功能

- `/login`：邮箱和密码登录；账号由管理员在 Supabase Dashboard 创建。本阶段不含公开注册、密码找回页面。
- `/`：首次打开自动创建当天的空计划；添加任务、勾选完成、编辑今日目标、保存文字反馈和能量评价。
- `/goals`：新增、编辑长期目标，状态为进行中、已完成或已暂停。
- `/history`：查看今天之前的每日目标、任务、完成率和反馈，每页 20 天。
- `/butler`：保留功能介绍，未接 AI、定时任务或好友监督。
- 业务页面通过服务端验证登录状态；浏览器和服务端使用 `@supabase/ssr` cookie 会话，Proxy 刷新会话。退出仅结束当前设备会话。
- 数据按账号保存在 Supabase。另一设备用同一账号登录，打开页面或点击“刷新云端数据”即可读取最新保存；不含实时推送或后台轮询。

## 日期、保存和冲突

为避免不同设备时区导致“今天”不同，统一采用 **Asia/Shanghai（北京时间 UTC+8）**，并在页面标注。跨午夜仍停留在旧页面时，保存会提示先刷新，不会把今天的输入误写到昨天。

所有写入都检查数据库返回值，只在确认成功后更新 UI；失败会提示，保留当前表单草稿。任务勾选在服务器确认后改变状态。请求结果不确定时应刷新核实，不能将本地界面当作保存凭据。

- 当天计划使用 `ON CONFLICT DO NOTHING` 和 `(user_id, plan_date)` 唯一约束，重复打开不会覆盖已有目标。
- 每日反馈有 `(user_id, feedback_date)` 唯一约束。首次保存发生并发冲突时会提示刷新。
- 编辑已有目标、计划、任务及反馈时匹配 `updated_at`，陈旧页面不能覆盖其他设备的新版本；发生冲突时请保留所需草稿，刷新后重新编辑。
- 新目标和任务在同一表单重试时复用 UUID，避免因响应丢失导致重试重复创建。
- 未保存草稿仅在当前页面；导航或关闭页面会丢失。主动刷新遇到草稿时会询问是否丢弃。

## 首次配置 Supabase Dashboard

1. 打开目标 Supabase 项目的 **SQL Editor → New query**。
2. 将 `supabase/migrations/001_initial_schema.sql` 的完整内容复制进去，以默认 `postgres` 身份执行一次。文件包含事务、四张表、索引、外键、更新时间触发器、RLS 和 16 条 policies。若报错先处理错误，不要跳过政策或关闭 RLS；已有同名表时应先核对结构，不要直接删除已有数据。
3. 在 **Table Editor / Database → Tables** 检查 `goals`、`daily_plans`、`tasks`、`daily_feedback` 均启用 RLS。在对应表的 Policies 中检查 SELECT、INSERT、UPDATE、DELETE 四条策略。
4. 在 **Authentication → Sign In / Providers（或 Providers）→ Email** 确认邮箱密码登录开启。
5. 在 **Authentication → Users → Add user → Create new user** 创建邮箱和强密码账号，勾选自动确认邮箱（或确保账号完成邮箱确认）。本阶段没有注册入口或邮件回调，因此管理员创建并确认的账号可直接登录。
6. 在 **Authentication → URL Configuration** 将 Site URL 设置成实际 Vercel 生产域名。当前邮箱密码登录无需 OAuth 或邮件重定向回调；将来引入邮件确认/找回密码时再配置相应 Redirect URLs。
7. 在项目 Connect / API Keys 中确认 Vercel 的 Project URL 和 Publishable Key 属于同一项目。

数据库只授予 `authenticated` 角色 SELECT / INSERT / UPDATE / DELETE；匿名角色无表权限。四表 `user_id` 均非空并关联 `auth.users`。每张表的 RLS 使用 `(select auth.uid()) = user_id`；UPDATE 同时检查旧行与新行归属。任务使用 `(daily_plan_id, user_id)` 复合外键，不能引用他人的计划。删除账号会级联清理该账号的数据。

不要使用 SQL Editor 的管理员查询结果判断用户隔离是否有效；管理员具备绕过 RLS 的权限。应使用两个独立登录账号进行应用或 Data API 验收。

## 环境变量和 Vercel

仅需现有两个前端环境变量：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

不使用 secret/service_role key。`.env.example` 只有占位符；`.env.local` 和其他环境文件已被 Git 忽略。

在 Vercel 导入仓库，选择 Next.js、仓库根目录和 Node.js 22.x 或 24.x，使用默认安装与构建命令。将变量应用到需要的 Production / Preview 环境。执行 SQL、准备好账号后，确认最新 main 提交的部署成功；变量变更需要重新部署，因为 `NEXT_PUBLIC_*` 在构建时注入。未配置变量仍可执行构建，但运行时无法登录或访问云数据。

## 本地开发和校验

```bash
npm ci
cp .env.example .env.local
# 在本地填写相同 Supabase 项目的 URL 和 Publishable Key
npm run dev
```

PowerShell 复制模板：`Copy-Item .env.example .env.local`。打开 http://localhost:3000。

```bash
npm run test:db
npm run lint
npm run build
npm run start
```

`test:db` 使用内存 PostgreSQL（PGlite）执行真实迁移；仅模拟 Supabase 提供的 `auth.users`、`auth.uid()` 和角色。覆盖四表增删改查隔离、禁止更换所有者、匿名拒绝访问、跨用户外键、唯一约束、合法取值、更新时间触发器、陈旧版本冲突和删除级联。不会连接或修改真实 Supabase 项目。

建议上线验收：两个设备登录同一账号，创建/编辑目标、添加与勾选任务、保存反馈，在另一端刷新核对；断网保存应报错；第二个不同账号应看不到第一账号的数据；退出后重新访问业务 URL 应跳转登录。历史页面将在存在过往日期计划后显示记录。

## 目录

```text
src/app/login/                  登录页面
src/app/(protected)/            业务页面及服务端登录校验
src/proxy.ts                    请求登录保护和 cookie 会话刷新
src/components/                 表单、页面交互、云端状态与导航
src/lib/cloud.ts                数据读写、日期、冲突检查与错误信息
src/lib/supabase/               类型化浏览器/服务端客户端
supabase/migrations/            首次建表与 RLS SQL
tests/rls.test.mjs              数据库安全回归测试
```

参考：[Supabase SSR 客户端](https://supabase.com/docs/guides/auth/server-side/creating-a-client)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。
