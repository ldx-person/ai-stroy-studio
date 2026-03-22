import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import {
  saveChapterContent,
  updateChapterInIndex,
  getChapterContent,
  isOSSAvailable,
  getNovelFromOSS,
} from '@/lib/oss'
import { recomputeNovelWordCountFromOss } from '@/lib/novel-oss-helpers'
import { sumWordCountsFromBodies } from '@/lib/word-count'
import {
  generateStoryStructure,
  generateBatchOutlines,
  generateFullChapter,
  generateChapterOpening,
  generateSummary,
  type StoryContext,
  type ChapterPlan,
} from '@/lib/ai-chapter-gen'
import { z } from 'zod'

export const runtime = 'nodejs'

const requestSchema = z.object({
  novelId: z.string().min(1),
  orders: z.array(z.number().int().min(0)),
  generateMode: z.enum(['full', 'opening']).optional().default('full'),
})

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

    const { novelId, orders, generateMode } = validation.data
    if (orders.length === 0) {
      return NextResponse.json({ success: false, error: '没有需要补全的章节' }, { status: 400 })
    }

    const full = await getNovelFromOSS(novelId)
    if (!full || !full.description || full.description.length < 20) {
      return NextResponse.json({ success: false, error: '小说不存在或简介不足' }, { status: 400 })
    }

    const novel = full.meta
    const allChapters = [...full.chapters].sort((a, b) => a.order - b.order)

    const orderCounts = new Map<number, number>()
    for (const c of allChapters) {
      orderCounts.set(c.order, (orderCounts.get(c.order) ?? 0) + 1)
    }
    if ([...orderCounts.values()].some((n) => n > 1)) {
      return NextResponse.json(
        {
          success: false,
          error: '存在相同排序位（order）的多章，请先在「章节检测」中处理重复后再补全',
        },
        { status: 409 }
      )
    }

    const maxOrder = allChapters.length > 0 ? Math.max(...allChapters.map((c) => c.order)) : 0
    const totalChapters = Math.max(maxOrder + 1, ...orders, 1)
    const fromBodies = sumWordCountsFromBodies(allChapters)
    const totalWords =
      fromBodies > 0 ? fromBodies : novel.wordCount || totalChapters * 1000
    const wordsPerChapter = Math.floor(totalWords / totalChapters)

    /** 同 order 只保留首次出现的章，避免重复 order 时 Map 被覆盖导致衔接上下文错误 */
    const orderToChapter = new Map<number, (typeof allChapters)[0]>()
    for (const c of allChapters) {
      if (!orderToChapter.has(c.order)) {
        orderToChapter.set(c.order, c)
      }
    }

    const context: StoryContext = { characters: [], recentSummaries: [] }
    let previousContent = ''

    const structure = await generateStoryStructure(
      novel.title,
      full.description,
      novel.genre,
      totalWords,
      totalChapters
    )

    const created: Array<{ id: string; title: string; order: number; wordCount: number }> = []

    for (const order of orders.sort((a, b) => a - b)) {
      const plans = await generateBatchOutlines(
        novel.title,
        novel.genre,
        structure,
        order,
        1,
        totalChapters,
        wordsPerChapter,
        context
      )

      if (!plans || plans.length === 0) continue
      const plan = plans[0] as ChapterPlan

      const prevChapter = order > 0 ? orderToChapter.get(order - 1) : null
      if (prevChapter) {
        const c = prevChapter.content || (await getChapterContent(novelId, prevChapter.id))
        previousContent = c
      }

      const content =
        generateMode === 'full'
          ? await generateFullChapter(
              novel.title,
              novel.genre,
              plan,
              structure,
              context,
              previousContent
            )
          : await generateChapterOpening(novel.title, novel.genre, plan, context, previousContent)

      const summary = await generateSummary(content)
      context.recentSummaries.push(summary)
      if (context.recentSummaries.length > 5) context.recentSummaries.shift()

      const chapterId = randomUUID()
      await saveChapterContent(novelId, chapterId, content)
      await updateChapterInIndex(novelId, chapterId, {
        title: plan.title,
        chapterNumber: order + 1,
        wordCount: content.length,
        order,
        isPublished: false,
      })

      const synthetic = {
        id: chapterId,
        title: plan.title,
        content,
        wordCount: content.length,
        order,
        isPublished: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      orderToChapter.set(order, synthetic as (typeof allChapters)[0])
      previousContent = content
      created.push({ id: chapterId, title: plan.title, order, wordCount: content.length })
    }

    const totalGeneratedWords = created.reduce((s, c) => s + c.wordCount, 0)
    await recomputeNovelWordCountFromOss(novelId)

    return NextResponse.json({
      success: true,
      created,
      totalWords: totalGeneratedWords,
    })
  } catch (error) {
    console.error('Fill gaps error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '补全失败' },
      { status: 500 }
    )
  }
}
