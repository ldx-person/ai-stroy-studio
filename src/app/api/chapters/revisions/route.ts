import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'

// 创建版本记录
const createSchema = z.object({
  chapterId: z.string().min(1),
  content: z.string(),
  wordCount: z.number().int(),
  source: z.string().min(1), // 'ai_rewrite', 'ai_continue', 'ai_describe', 'manual', etc.
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || '参数验证失败' },
        { status: 400 }
      )
    }

    const { chapterId, content, wordCount, source, metadata } = parsed.data

    // 验证章节存在
    const chapter = await db.chapter.findUnique({
      where: { id: chapterId },
      select: { id: true }
    })

    if (!chapter) {
      return NextResponse.json({ success: false, error: '章节不存在' }, { status: 404 })
    }

    // 创建版本记录
    const revision = await db.chapterRevision.create({
      data: {
        chapterId,
        content,
        wordCount,
        source,
        metadata: metadata ? JSON.stringify(metadata) : null,
      }
    })

    return NextResponse.json({ success: true, revision })
  } catch (error) {
    console.error('Create revision error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to create revision' },
      { status: 500 }
    )
  }
}

// 获取版本历史列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const chapterId = searchParams.get('chapterId')

    if (!chapterId) {
      return NextResponse.json({ success: false, error: '缺少 chapterId 参数' }, { status: 400 })
    }

    const revisions = await db.chapterRevision.findMany({
      where: { chapterId },
      orderBy: { createdAt: 'desc' },
      take: 50, // 最多返回最近50个版本
    })

    return NextResponse.json({ success: true, revisions })
  } catch (error) {
    console.error('Get revisions error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to get revisions' },
      { status: 500 }
    )
  }
}

// 恢复到指定版本
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { revisionId } = body

    if (!revisionId) {
      return NextResponse.json({ success: false, error: '缺少 revisionId' }, { status: 400 })
    }

    // 获取指定版本
    const revision = await db.chapterRevision.findUnique({
      where: { id: revisionId },
      include: { chapter: true }
    })

    if (!revision) {
      return NextResponse.json({ success: false, error: '版本不存在' }, { status: 404 })
    }

    // 先保存当前内容为新的版本（以便可以撤销恢复）
    await db.chapterRevision.create({
      data: {
        chapterId: revision.chapterId,
        content: revision.chapter.content,
        wordCount: revision.chapter.wordCount,
        source: 'restore',
        metadata: JSON.stringify({ restoredFrom: revisionId }),
      }
    })

    // 恢复章节内容
    const updatedChapter = await db.chapter.update({
      where: { id: revision.chapterId },
      data: {
        content: revision.content,
        wordCount: revision.wordCount,
      }
    })

    return NextResponse.json({ success: true, chapter: updatedChapter })
  } catch (error) {
    console.error('Restore revision error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to restore revision' },
      { status: 500 }
    )
  }
}
