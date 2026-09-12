# 成长管家 · Growth Butler

基于 Next.js App Router、TypeScript 和 Supabase 的个人成长 Web App，支持部署到 Vercel。

## 第一阶段

- 响应式中文界面：桌面侧边栏、手机底部导航。
- `/`：今日计划、今日目标、任务完成进度、今日反馈。
- `/goals`：示例长期目标；`/history`：历史记录空状态；`/butler`：未来管家功能介绍。
- 今日任务勾选可更新进度，反馈可选择心情并记录在页面状态中。
- 所有数据均为演示数据；离开或刷新首页后重置，没有数据库、登录、云端保存或 AI 请求。

## 本地运行

使用 Node.js 22 或 24 LTS 和 npm。

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Windows PowerShell 使用 `Copy-Item .env.example .env.local`。打开 http://localhost:3000。
当前演示无需配置 Supabase 即可启动、构建。需要连接 Supabase 时，在 `.env.local` 填写：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

`.env.example` 只包含占位符；`.env.local` 及其他环境文件均被 Git 忽略。不要把真实密钥提交到仓库，也不要向前端变量填入 Supabase secret 或 service_role key。

## Supabase 客户端

`src/lib/supabase/config.ts` 读取并检查上述变量。
`src/lib/supabase/client.ts` 使用 `@supabase/ssr` 封装浏览器客户端，按需初始化，并复用浏览器实例。

```tsx
// 在需要访问 Supabase 的 Client Component 中调用；当前演示不调用。
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();
```

缺少变量时，只有实际调用工厂函数才报配置错误，不影响基础页面。后续接入认证时再添加服务端客户端和会话刷新逻辑；本阶段没有创建任何数据库表。

## 校验与生产运行

```bash
npm run lint
npm run build
npm run start
```

`next build` 包含 TypeScript 检查；ESLint 单独运行。依赖版本锁定于 `package-lock.json`。

## 部署到 Vercel

1. 在 Vercel 新建项目，导入 `ManciaFan/growth-butler` GitHub 仓库。
2. Framework Preset 选择 Next.js，Root Directory 使用仓库根目录，Node.js 选择 22.x 或 24.x。
3. 使用默认构建设置：安装 `npm ci`，构建 `npm run build`，输出目录由 Next.js 预设管理。
4. 可先直接部署演示。准备连接 Supabase 时，在 Vercel 项目 Environment Variables 配置上述两个变量，按需要应用到 Production 和 Preview。
5. 保存环境变量后重新部署，因为 `NEXT_PUBLIC_*` 在构建时注入浏览器代码。

无需 `vercel.json` 或数据库迁移。后续阶段再设计数据表、RLS、认证和持久化逻辑。

## 目录

```text
src/app/                  页面、布局、样式与 404
src/components/           导航框架和今日交互面板
src/lib/demo-data.ts      演示数据
src/lib/supabase/         Supabase 配置与客户端
.env.example             环境变量模板
```

技术参考：[Next.js 安装文档](https://nextjs.org/docs/app/getting-started/installation)、[Supabase Next.js 文档](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs)。
