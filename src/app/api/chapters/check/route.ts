import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getNovelMetaFromOSS, isOSSAvailable, type OSSChapterMeta } from '@/lib/oss'
import { normalizeChapterIndexEntries } from '@/lib/chapter-meta'

export const runtime = 'nodejs'

const requestSchema = z.object({
  novelId: z.string().min(1),
  /** 缺失检测上界（开区间）：仅统计 order ∈ [0, rangeEnd) 内的洞；省略则用 maxOrder+1 */
  rangeEnd: z.number().int().min(0).optional(),
})

type WorkingChapter = {
  id: string
  title: string
  wordCount: number
  order: number
  chapterNumber?: number
  contentPreview: string
}

function makePreview(title: string, wordCount: number): string {
  const t = (title || '（无标题）').trim()
  const head = t.length > 56 ? `${t.slice(0, 56)}…` : t
  return `${head} · ${wordCount} 字`
}

export async function POST(request: NextRequest) {
  try {
    if (!isOSSAvailable()) {
      return NextResponse.json({ success: false, error: 'OSS 未配置' }, { status: 503 })
    }
    const body = await request.json()
    const validation = requestSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0]?.message },
        { status: 400 }
      )
    }
    const { novelId, rangeEnd } = validation.data
    const meta = await getNovelMetaFromOSS(novelId)
    if (!meta) {
      return NextResponse.json(
        { success: false, error: '小说不存在或无法读取 OSS 元数据' },
        { status: 404 }
      )
    }

    const rawChapters: OSSChapterMeta[] = Array.isArray(meta.chapters) ? meta.chapters : []
    const normalized = normalizeChapterIndexEntries([...rawChapters])
    const byId = new Map(normalized.map((c) => [c.id, c]))

    const chapters: WorkingChapter[] = rawChapters.map((c) => {
      const n = byId.get(c.id)
      const title = n?.title ?? c.title
      return {
        id: c.id,
        title,
        wordCount: typeof c.wordCount === 'number' ? c.wordCount : 0,
        order: c.order,
        chapterNumber: n?.chapterNumber,
        contentPreview: makePreview(title, typeof c.wordCount === 'number' ? c.wordCount : 0),
      }
    })

    const maxOrder = chapters.length > 0 ? Math.max(...chapters.map((c) => c.order)) : -1
    const end = rangeEnd ?? maxOrder + 1
    const rangeStart = 0

    const orderMap = new Map<number, WorkingChapter[]>()
    for (const ch of chapters) {
      if (!orderMap.has(ch.order)) orderMap.set(ch.order, [])
      orderMap.get(ch.order)!.push(ch)
    }

    const duplicates: Array<{
      order: number
      chapters: Array<{
        id: string
        title: string
        wordCount: number
        chapterNumber?: number
        contentPreview: string
      }>
    }> = []

    for (const [order, chs] of orderMap) {
      if (chs.length > 1 && order >= rangeStart && order < end) {
        duplicates.push({
          order,
          chapters: chs.map((c) => ({
            id: c.id,
            title: c.title,
            wordCount: c.wordCount,
            chapterNumber: c.chapterNumber,
            contentPreview: c.contentPreview,
          })),
        })
      }
    }

    const existingOrders = new Set(chapters.map((c) => c.order))
    const gaps: number[] = []
    for (let i = rangeStart; i < end; i++) {
      if (!existingOrders.has(i)) gaps.push(i)
    }

    // 按阅读顺序（order 升序）检查「第几章」是否从 1 连续：第 1 条应为第 1 章，依此类推
    const sortedNorm = [...normalized].sort((a, b) => {
      if (a.order !== b.order) return (a.order ?? 0) - (b.order ?? 0)
      return a.id.localeCompare(b.id)
    })
    const chapterNumberMismatches: Array<{
      sortIndex: number
      order: number
      id: string
      title: string
      expectedChapterNumber: number
      actualChapterNumber: number
    }> = []
    sortedNorm.forEach((ch, i) => {
      const expected = i + 1
      const raw =
        typeof ch.chapterNumber === 'number' && Number.isFinite(ch.chapterNumber) && ch.chapterNumber >= 1
          ? Math.floor(ch.chapterNumber)
          : expected
      if (raw !== expected) {
        chapterNumberMismatches.push({
          sortIndex: i,
          order: ch.order ?? i,
          id: ch.id,
          title: ch.title,
          expectedChapterNumber: expected,
          actualChapterNumber: raw,
        })
      }
    })
    const chapterNumberAligned = chapterNumberMismatches.length === 0
    const firstCh = sortedNorm[0]
    const firstSlotNotChapterOne =
      sortedNorm.length > 0 &&
      (typeof firstCh?.chapterNumber !== 'number' ||
        !Number.isFinite(firstCh.chapterNumber) ||
        Math.floor(firstCh.chapterNumber) !== 1)

    return NextResponse.json({
      success: true,
      duplicates,
      gaps,
      range: { start: rangeStart, end },
      totalChapters: chapters.length,
      chapterNumberIssues: {
        aligned: chapterNumberAligned,
        /** 按 order 排序后，首条记录的 chapterNumber 是否不是 1 */
        firstSlotNotChapterOne,
        mismatches: chapterNumberMismatches,
      },
      /** 说明：重复/缺失均按 OSS 索引中的 order（排序位）；title/chapterNumber 经归一化展示 */
      hint:
        '重复按相同 order 判定；缺失为 [0,maxOrder] 内未被占用的 order。章号连续性：按 order 升序第 i 条应对应「第 i+1 章」。与列表展示一致前请先运行章节元数据归一化。',
    })
  } catch (error) {
    console.error('Chapter check error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '检测失败' },
      { status: 500 }
    )
  }
}
