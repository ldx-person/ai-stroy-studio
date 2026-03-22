/**
 * 全书 / 章节字数统计（单一规则，避免 novel.json 与 chapters.json 各算各的）
 *
 * **定义**：与 `chapters/{id}.txt` 经 UTF-8 解码后的 JavaScript 字符串 `length` 一致
 *（UTF-16 码元；中文、常见标点一般为 1 字符 = 1 单位，与现有 `content.length` 用法兼容）
 *
 * **层级**：
 * 1. 真相：正文 `.txt`
 * 2. 索引：`chapters.json[].wordCount` 应在每次写正文时同步
 * 3. 全书：`novel.json.wordCount` 为派生缓存 = Σ 章节索引字数（列表/详情展示优先用聚合值，避免缓存陈旧）
 */

export function countWordsFromText(text: string): number {
  return text.length
}

export function sumWordCountsFromChapterIndex(
  chapters: ReadonlyArray<{ wordCount?: number | null }>
): number {
  return chapters.reduce((s, ch) => s + (typeof ch.wordCount === 'number' ? ch.wordCount : 0), 0)
}

/** 已从 OSS 拉取正文时使用（以正文为准，修正索引陈旧导致的展示误差） */
export function sumWordCountsFromBodies(
  chapters: ReadonlyArray<{ content?: string | null }>
): number {
  return chapters.reduce((s, ch) => s + countWordsFromText(ch.content ?? ''), 0)
}
