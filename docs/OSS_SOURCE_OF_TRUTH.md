# OSS 为唯一真相源（Source of Truth），DB 仅缓存与辅助数据

## 实施状态（仓库当前）

- **已实现**：作品读写走 OSS；API `/api/novels`、`/api/novels/[id]`、`/api/chapters`、`/api/chapters/revisions`、`/api/chapters/check`、导出、`smart-generate` / `stream-generate` / `fill-gaps` 已改为 OSS 优先；`/api/oss/sync` 为兼容占位。
- **DB**：仅 `ChapterRevision`、`BackgroundTask`（见 `prisma/schema.prisma`）。
- **迁移步骤**：见 [MIGRATION_OSS_PRIMARY.md](./MIGRATION_OSS_PRIMARY.md)。

---

本文仍保留**设计说明**与后续可选增强（列表缓存表等）。

---

## 1. 数据归属矩阵

| 数据 | 真相源 | 说明 |
|------|--------|------|
| 小说元数据、简介、大纲、角色、章节索引、章节正文、Story Bible | **OSS** `novels/{id}/…` | 与现有 `src/lib/oss.ts` 目录结构一致；章节索引含 `chapterNumber`（第几章）与 `title`（标题正文，不含「第N章」前缀） |
| 章节修订历史（diff/回滚/AI 来源） | **DB** | 高频追加写、列表查询、与对象存储键 `novelId+chapterId` 关联 |
| 异步长任务状态（智能生成、导出、检测） | **DB** | 进度、失败重试、与 `taskId` 关联 |
| 用户会话 / OAuth / API 限流（若引入） | **DB 或 Redis** | 与作品正文无关 |
| **列表/详情加速** | **DB 缓存（可丢）** | 仅存快照或索引行，`syncedAt`/`etag`；丢失后全量从 OSS 重建 |

原则：**任何「作品正文的权威版本」只以 OSS 为准**；DB 中的小说/章节行若保留，仅作**缓存**，字段需带 `source: 'cache'` 语义，且可整表 truncate 后从 OSS 回填。

---

## 2. 目标 Prisma 模型（精简 DB）

以下为**建议** schema，与当前 `schema.prisma` 并存时需通过迁移分步替换（先加表、再迁数据、再删旧表）。

### 2.1 保留 / 新增

```prisma
// 可选：列表/元数据缓存（可整表重建）
model NovelListCache {
  novelId     String   @id
  title       String
  wordCount   Int      @default(0)
  status      String   @default("draft")
  updatedAtOss String  // 来自 OSS novel.json，用于比较是否过期
  cachedAt    DateTime @default(now())
}

// 可选：单本摘要缓存（大字段慎用，可只存 wordCount+章节数）
model NovelSummaryCache {
  novelId   String @id
  json      String // 或压缩 blob，TTL 策略由业务定
  cachedAt  DateTime @updatedAt
}

// 修订历史 — OSS 不适合的追加流
model ChapterRevision {
  id          String   @id @default(cuid())
  novelId     String   // OSS 小说 id
  chapterId   String   // OSS 章节 id
  content     String
  wordCount   Int
  source      String
  metadata    String?
  createdAt   DateTime @default(now())
  @@index([novelId, chapterId])
}

// 异步任务（智能生成、批量检测等）
model BackgroundTask {
  id        String   @id @default(cuid())
  type      String
  status    String   // pending | running | done | failed
  novelId   String?
  payload   String?  // JSON
  result    String?  // JSON
  error     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([status])
}
```

### 2.2 删除（从真相源角度）

- `Novel` / `Chapter` / `Character` **作为权威表**删除；若过渡期需要「双写」，可暂时保留为缓存表并改名或在代码中明确只读缓存。

---

## 3. 读写与一致性规则

### 3.1 读路径

1. **列表**：`listOSSNovels()`（或分页 list 前缀）；可选读 `NovelListCache` 若未过期。
2. **详情元数据 + 章节目录**：`getNovelMetaFromOSS(id)`。
3. **章节正文**：`getChapterContent(novelId, chapterId)` 或按需 `getNovelFromOSS`（大书慎用）。
4. 若启用 DB 缓存：先比 `updatedAtOss` / `etag`，命中则返回缓存；否则读 OSS 并回写缓存。

### 3.2 写路径（必须先 OSS）

1. 更新章节：**先** `saveChapterContent` + `updateChapterInIndex`，**成功后再**（可选）更新缓存行 / 失效列表缓存。
2. 更新小说元数据：**先** `updateNovelMeta` / `saveNovelToOSS`，再处理缓存。
3. **禁止**「只写 DB、异步写 OSS」作为最终一致——若必须异步，需 **Outbox** 表记录待上传对象，失败可重试并对照 OSS。

### 3.2.1 字数与章节数（统一规则）

| 指标 | 定义 | 说明 |
|------|------|------|
| **章节数** | `chapters.json` 数组长度 | 与 OSS 中索引条目一致 |
| **章字数** | 与该章 `chapters/{id}.txt` UTF-8 解码后字符串的 `length` 一致 | 实现为 `countWordsFromText`（`src/lib/word-count.ts`），与历史 `content.length` 行为相同 |
| **全书字数** | Σ 章字数 | **展示**：列表用 `chapters.json` 各章 `wordCount` 求和；详情在已加载正文时用正文重算各章再求和，**不直接采信**可能与索引脱节的 `novel.json.wordCount` |
| **novel.json.wordCount** | 派生缓存 | 每次章节写入后由 `recomputeNovelWordCountFromOss` 写回，应与 Σ 章一致；若外部改过 `.txt` 或历史脏数据，运行 `scripts/oss-reconcile-word-counts.js` 或 `POST /api/oss/reconcile-word-counts` |

**原则**：正文 `.txt` 为真相；索引在每次 `saveChapterContent` 时同步；客户端**不得**仅通过 API 上报字数覆盖正文（PUT 仅改 `wordCount` 时会按 OSS 正文重算）。

### 3.3 修订（Revision）

- 在**写 OSS 正文之前或之后**（需统一）：插入 `ChapterRevision`（仅存 DB），`novelId`/`chapterId` 与 OSS 键一致，便于按章回滚时从修订表取历史，再 `saveChapterContent` 写回 OSS。

---

## 4. 迁移阶段（建议）

| 阶段 | 内容 |
|------|------|
| **P0** | 引入 `src/lib/novel-repository-oss-primary.ts`（OSS 优先 API），新功能只走 Repository；文档冻结一致性规则。 |
| **P1** | `GET /api/novels`、`GET/PATCH /api/novels/[id]`、`/api/chapters` 改为：读 OSS → 写 OSS；DB 只做 revision + task + 可选 cache。 |
| **P2** | 删除或清空旧 `Novel`/`Chapter`/`Character` 表；`GET /api/oss/sync` 改为「刷新缓存」或删除。 |
| **P3** | 前端状态管理：列表以 OSS 为准；离线策略（可选 Service Worker + 本地草稿，同步仍回 OSS）。 |

---

## 5. 风险与权衡

- **延迟与费用**：每次打开章节可能 1 次 OSS GET；需客户端缓存与合并请求。
- **冲突**：多设备同时改需 **ETag / version**（可在 `novel.json` 增加 `revision` 字段）或「后写覆盖」策略。
- **SQLite 缓存**：适合单机；多实例部署应换 Redis 做列表缓存。

---

## 6. 与现有代码的映射

| 现有模块 | 目标 |
|----------|------|
| `src/lib/oss.ts` | 保持为 OSS 底层实现 |
| `src/lib/novel-repository-oss-primary.ts` | 唯一业务入口（读写信条） |
| `src/app/api/oss/sync` | 改为 `POST /api/cache/rebuild` 或删除 |
| `src/app/api/chapters/revisions` | 保留，关联 `novelId`+`chapterId` 字符串 |

---

*文档版本：与仓库同步迭代；实施时请配具体 Issue/里程碑。*
