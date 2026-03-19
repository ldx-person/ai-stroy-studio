import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  saveChapterContent,
  updateChapterInIndex,
  updateNovelMeta,
  getChapterContent,
  isOSSAvailable
} from '@/lib/oss'
import {
  generateStoryStructure,
  generateBatchOutlines,
  generateFullChapter,
  generateChapterOpening,
  generateSummary,
  type StoryContext,
  type ChapterPlan
} from '@/lib/ai-chapter-gen'
import { z } from 'zod'

const requestSchema = z.object({
  novelId: z.string().min(1),
  orders: z.array(z.number().int().min(0)),
  generateMode: z.enum(['full', 'opening']).optional().default('full')
})

async function getChapterContentSafe(novelId: string, chapterId: string, dbContent: string): Promise<string> {
  if (dbContent && dbContent.length > 0) return dbContent
  if (isOSSAvailable()) {
    try {
      const ossContent = await getChapterContent(novelId, chapterId)
      if (ossContent) return ossContent
    } catch {
      // ignore
    }
  }
  return ''
}

export async function POST(request: NextRequest) {
  try {
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

    const novel = await db.novel.findUnique({
      where: { id: novelId },
      select: { title: true, description: true, genre: true, wordCount: true }
    })
    if (!novel || !novel.description || novel.description.length < 20) {
      return NextResponse.json({ success: false, error: '小说不存在或简介不足' }, { status: 400 })
    }

    const allChapters = await db.chapter.findMany({
      where: { novelId },
      orderBy: { order: 'asc' },
      select: { id: true, title: true, content: true, wordCount: true, order: true }
    })

    const maxOrder = allChapters.length > 0 ? Math.max(...allChapters.map((c) => c.order)) : 0
    const totalChapters = Math.max(maxOrder + 1, ...orders, 1)
    const totalWords = novel.wordCount || totalChapters * 1000
    const wordsPerChapter = Math.floor(totalWords / totalChapters)

    const orderToChapter = new Map(allChapters.map((c) => [c.order, c]))
    const context: StoryContext = { characters: [], recentSummaries: [] }
    let previousContent = ''

    const structure = await generateStoryStructure(
      novel.title,
      novel.description,
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

      if (!plans || plans.length === 0) {
        continue
      }
      const plan = plans[0] as ChapterPlan

      const prevChapter = order > 0 ? orderToChapter.get(order - 1) : null
      if (prevChapter) {
        previousContent = await getChapterContentSafe(novelId, prevChapter.id, prevChapter.content || '')
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

      const chapter = await db.chapter.create({
        data: {
          novelId,
          title: plan.title,
          content,
          wordCount: content.length,
          order
        }
      })

      if (isOSSAvailable()) {
        try {
          await saveChapterContent(novelId, chapter.id, content)
          await updateChapterInIndex(novelId, chapter.id, {
            title: plan.title,
            wordCount: content.length,
            order
          })
        } catch (e) {
          console.error('OSS sync failed:', e)
        }
      }

      orderToChapter.set(order, { ...chapter, content, wordCount: content.length })
      previousContent = content
      created.push({ id: chapter.id, title: plan.title, order, wordCount: content.length })
    }

    const totalGeneratedWords = created.reduce((s, c) => s + c.wordCount, 0)
    const currentTotal = allChapters.reduce((s, c) => s + (c.wordCount || 0), 0)
    const newTotal = currentTotal + totalGeneratedWords

    await db.novel.update({
      where: { id: novelId },
      data: { wordCount: newTotal }
    })
    if (isOSSAvailable()) {
      try {
        await updateNovelMeta(novelId, { wordCount: newTotal })
      } catch {
        // ignore
      }
    }

    return NextResponse.json({
      success: true,
      created,
      totalWords: totalGeneratedWords
    })
  } catch (error) {
    console.error('Fill gaps error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '补全失败' },
      { status: 500 }
    )
  }
}
