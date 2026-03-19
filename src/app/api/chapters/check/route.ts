import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'

const requestSchema = z.object({
  novelId: z.string().min(1),
  rangeEnd: z.number().int().min(0).optional() // 检测范围上限（不含），不传则用最大 order
})

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

    const { novelId, rangeEnd } = validation.data

    const chapters = await db.chapter.findMany({
      where: { novelId },
      orderBy: { order: 'asc' },
      select: { id: true, title: true, wordCount: true, order: true, content: true }
    })

    const maxOrder = chapters.length > 0 ? Math.max(...chapters.map((c) => c.order)) : -1
    const end = rangeEnd ?? maxOrder + 1
    const rangeStart = 0

    // 检测重复：同一 order 下有多于一个章节
    const orderMap = new Map<number, typeof chapters>()
    for (const ch of chapters) {
      if (!orderMap.has(ch.order)) {
        orderMap.set(ch.order, [])
      }
      orderMap.get(ch.order)!.push(ch)
    }

    const duplicates: Array<{
      order: number
      chapters: Array<{ id: string; title: string; wordCount: number; contentPreview: string }>
    }> = []

    for (const [order, chs] of orderMap) {
      if (chs.length > 1 && order >= rangeStart && order < end) {
        duplicates.push({
          order,
          chapters: chs.map((c) => ({
            id: c.id,
            title: c.title,
            wordCount: c.wordCount,
            contentPreview: (c.content || '').slice(0, 80) + (c.content && c.content.length > 80 ? '...' : '')
          }))
        })
      }
    }

    // 检测缺失：范围内哪些 order 没有章节
    const existingOrders = new Set(chapters.map((c) => c.order))
    const gaps: number[] = []
    for (let i = rangeStart; i < end; i++) {
      if (!existingOrders.has(i)) {
        gaps.push(i)
      }
    }

    return NextResponse.json({
      success: true,
      duplicates,
      gaps,
      range: { start: rangeStart, end },
      totalChapters: chapters.length
    })
  } catch (error) {
    console.error('Chapter check error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '检测失败' },
      { status: 500 }
    )
  }
}
