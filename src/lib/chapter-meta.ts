/**
 * 章节序号（第 N 章）与标题正文分离：归一化与历史标题解析
 * （不 import oss.ts，避免循环依赖）
 */

/** 与 OSS chapters.json 单条结构一致的可归一化字段 */
export type ChapterIndexEntry = {
  id: string
  title: string
  wordCount: number
  order: number
  isPublished: boolean
  createdAt: string
  updatedAt: string
  chapterNumber?: number
}

/** 匹配「第12章」「第 12 章：」等，捕获阿拉伯数字 */
const RE_CHAPTER_ARABIC = /^第\s*(\d+)\s*章\s*[、:：.\s\-—]*\s*(.*)$/su

/** 匹配「第3章」单字中文数字 一至九 */
const RE_CHAPTER_CN_SINGLE = /^第\s*([一二三四五六七八九])\s*章\s*[、:：.\s\-—]*\s*(.*)$/su

/** 匹配「第十章」「第十一章」…「第十九章」 */
const RE_CHAPTER_TEEN = /^第\s*(十[一二三四五六七八九]?)\s*章\s*[、:：.\s\-—]*\s*(.*)$/su

/** 「12. 标题」「12、标题」 */
const RE_CHAPTER_DOT = /^(\d+)\s*[、.．]\s*(.+)$/su

const CN_ONE_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

function parseChineseTeen(s: string): number | null {
  const t = s.trim()
  if (t === '十') return 10
  if (t.startsWith('十') && t.length === 2) {
    const u = CN_ONE_DIGIT[t[1]!]
    return u != null ? 10 + u : null
  }
  return null
}

export interface ParsedChapterTitle {
  chapterNumber: number
  titleRest: string
}

/**
 * 从整段标题中解析「章号 + 剩余标题」；无法解析时返回 null
 */
export function parseLegacyChapterTitle(raw: string): ParsedChapterTitle | null {
  const s = raw.trim()
  if (!s) return null

  let m = s.match(RE_CHAPTER_ARABIC)
  if (m) {
    const n = parseInt(m[1]!, 10)
    if (n >= 1) return { chapterNumber: n, titleRest: (m[2] ?? '').trim() }
  }

  m = s.match(RE_CHAPTER_TEEN)
  if (m) {
    const n = parseChineseTeen(m[1]!)
    if (n != null && n >= 1) return { chapterNumber: n, titleRest: (m[2] ?? '').trim() }
  }

  m = s.match(RE_CHAPTER_CN_SINGLE)
  if (m) {
    const n = CN_ONE_DIGIT[m[1]!]
    if (n != null) return { chapterNumber: n, titleRest: (m[2] ?? '').trim() }
  }

  m = s.match(RE_CHAPTER_DOT)
  if (m) {
    const n = parseInt(m[1]!, 10)
    if (n >= 1) return { chapterNumber: n, titleRest: (m[2] ?? '').trim() }
  }

  return null
}

const PLACEHOLDER_TITLE = '（无标题）'

/**
 * 去掉标题里「第N章」「12. 标题」等遗留前缀，仅保留正文标题（用于章号按顺序重排后写回索引）
 */
export function stripLegacyChapterPrefixFromTitle(raw: string): string {
  const parsed = parseLegacyChapterTitle(raw)
  if (parsed) {
    const rest = parsed.titleRest.trim()
    return rest || PLACEHOLDER_TITLE
  }
  const t = (raw || '').trim()
  return t || PLACEHOLDER_TITLE
}

/**
 * 按 order 排序后：补全 chapterNumber、剥离标题里的「第N章」前缀；order 重排为 0..n-1
 * 用于读路径展示与一次性写回 OSS
 */
export function normalizeChapterIndexEntries<T extends ChapterIndexEntry>(chapters: T[]): T[] {
  const sorted = [...chapters].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  return sorted.map((ch, index): T => {
    const fromField =
      typeof ch.chapterNumber === 'number' && Number.isFinite(ch.chapterNumber) && ch.chapterNumber >= 1
        ? Math.floor(ch.chapterNumber)
        : null

    const parsed = parseLegacyChapterTitle(ch.title || '')
    const chapterNumber = fromField ?? parsed?.chapterNumber ?? index + 1

    let title = (ch.title || '').trim()

    if (parsed && (fromField == null || parsed.chapterNumber === fromField)) {
      title = parsed.titleRest.trim()
    } else if (fromField != null) {
      const again = parseLegacyChapterTitle(title)
      if (again && again.chapterNumber === fromField) {
        title = again.titleRest.trim()
      }
    }

    if (!title) title = PLACEHOLDER_TITLE

    return {
      ...ch,
      order: index,
      chapterNumber,
      title,
    } as T
  })
}
