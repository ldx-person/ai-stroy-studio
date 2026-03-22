# 从「SQLite 作品表」迁移到「OSS 真相源」

## 变更摘要

- **作品（小说/章节/角色）** 仅存在于 **阿里云 OSS** `novels/{novelId}/`。
- **SQLite** 仅保留：`chapter_revisions`（章节历史）、`background_tasks`（任务表，预留）。

## 你必须执行的操作

1. **备份** 原 `prisma/*.db`（若仍有重要数据）。
2. 在项目根目录执行（会按新 schema **重建表**，旧 `novels`/`chapters`/`characters` 数据将丢失）：

```bash
npx prisma generate
npx prisma db push
```

若 Windows 上 `prisma generate` 报 `EPERM`（引擎 DLL 被占用），请先**关闭所有 Node/Next 进程**再执行。

3. 确保 `.env.local` 中 **OSS** 与 **DATABASE_URL** 已配置；**未配置 OSS 时**，列表接口返回空列表，创建/编辑作品会失败。

## 数据恢复

旧 SQLite 中的正文不会自动导入 OSS。若需迁移，请使用脚本或控制台将旧数据按 `src/lib/oss.ts` 目录结构写入 OSS。
