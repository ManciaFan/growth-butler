# 课表空间部署说明

新增课表空间需要手动执行 `supabase/migrations/004_course_schedule.sql`。不会自动执行生产迁移，也不会把个人课表提交到 GitHub。

在 Supabase Dashboard 的 SQL Editor 中，确认 001、002、003 已经完成后执行 004 一次。检查 `course_schedule` 和 `schedule_settings` 开启 RLS，四条 owner policies 存在；`import_course_schedule` 仅授予 authenticated。随后在网站打开“课表”页面：默认作息已填入你提供的 1～12 节时间，第 13、14 节留空，可以按需要补齐并保存。

课程导入使用 JSON 预览后确认保存。已从 `download.xls` 整理出 146 条记录，日期范围为 2026-09-07 至 2026-12-22，保留课程名称、日期、节次和教室。导入文件：[course-schedule-2026-2027.json](../outputs/course-schedule-2026-2027.json)。由于原始 `.xls` 的编码元数据损坏，导入文件由单元格内容解析生成；页面不会直接上传或解析原始 Excel。

管家规划只查询明日课程；聊天根据用户消息提取相关日期，最多查询 7 天。课表课程是时间占用，不能被重复安排成任务。未配置作息的课程仍显示节次，管家不能猜测具体钟点；空课表也不代表全天有空。

使用同一账号在手机和电脑刷新可同步课表。修改和删除都带版本检查；失败时保留页面状态，不显示虚假成功。课表数据按账号隔离，原始 Excel 不会写入数据库。
