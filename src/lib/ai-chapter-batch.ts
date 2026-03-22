/**
 * 智能/流式批量生成章节：槽位（order）、阶段与大纲补齐（避免 AI 少返回条目导致跳号）
 */

export const CHAPTER_PHASE_RATIOS = {
  beginning: 0.15,
  middle: 0.7,
  ending: 0.15,
} as const

export type ChapterPhase = 'beginning' | 'middle' | 'ending'

export interface ChapterPlanSlice {
  index: number
  phase: ChapterPhase
  title: string
  outline: string
  estimatedWords: number
}

export function getPhaseForChapterIndex(index: number, totalChapters: number): ChapterPhase {
  const beginningEnd = Math.floor(totalChapters * CHAPTER_PHASE_RATIOS.beginning)
  const middleEnd = Math.floor(
    totalChapters * (CHAPTER_PHASE_RATIOS.beginning + CHAPTER_PHASE_RATIOS.middle)
  )
  if (index < beginningEnd) return 'beginning'
  if (index < middleEnd) return 'middle'
  return 'ending'
}

/** 0..chapterCount-1 中尚未占用 order 的槽位（升序） */
export function missingChapterOrderSlots(
  existingOrders: Iterable<number>,
  chapterCount: number
): number[] {
  const set = new Set(existingOrders)
  const out: number[] = []
  for (let i = 0; i < chapterCount; i++) {
    if (!set.has(i)) out.push(i)
  }
  return out
}

/** 是否 0..chapterCount-1 每个 order 都至少有一章 */
export function allChapterSlotsFilled(
  existingChapters: Array<{ order?: number }>,
  chapterCount: number
): boolean {
  if (chapterCount <= 0) return true
  const orders = new Set(
    existingChapters.map((c) => c.order).filter((o): o is number => typeof o === 'number')
  )
  for (let i = 0; i < chapterCount; i++) {
    if (!orders.has(i)) return false
  }
  return true
}

/** 将升序整数列分成连续区间，如 [0,1,2,5,6] -> [[0,1,2],[5,6]] */
export function groupConsecutiveIntegers(nums: number[]): number[][] {
  if (!nums.length) return []
  const sorted = [...nums].sort((a, b) => a - b)
  const groups: number[][] = [[sorted[0]!]]
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!
    const prev = sorted[i - 1]!
    if (n === prev + 1) groups[groups.length - 1]!.push(n)
    else groups.push([n])
  }
  return groups
}

/**
 * AI 返回的大纲条数可能少于批次；按 index 对齐并补齐缺槽，避免整书跳章。
 */
export function ensureChapterPlansCoverRange(
  raw: ChapterPlanSlice[],
  startIndex: number,
  endIndexExclusive: number,
  totalChapters: number,
  wordsPerChapter: number
): ChapterPlanSlice[] {
  const byIndex = new Map<number, ChapterPlanSlice>()
  for (const p of raw) {
    if (p.index >= startIndex && p.index < endIndexExclusive) {
      byIndex.set(p.index, p)
    }
  }
  const out: ChapterPlanSlice[] = []
  for (let i = startIndex; i < endIndexExclusive; i++) {
    let p = byIndex.get(i)
    if (!p) {
      p = {
        index: i,
        phase: getPhaseForChapterIndex(i, totalChapters),
        title: `第${i + 1}章`,
        outline:
          i === 0
            ? '故事开端：交代背景与人物，引入核心悬念或冲突。'
            : `紧接第${i}章收尾推进剧情，与全书结构、人物设定保持一致。`,
        estimatedWords: wordsPerChapter,
      }
    }
    out.push(p)
  }
  return out
}
