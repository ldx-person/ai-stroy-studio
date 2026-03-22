import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { getChapterContent, saveChapterContent, updateChapterInIndex, getNovelMetaFromOSS } from '@/lib/oss'
import { recomputeNovelWordCountFromOss } from '@/lib/novel-oss-helpers'

export const runtime = 'nodejs'

const createSchema = z.object({
  novelId: z.string().min(1),
  chapterId: z.string().min(1),
  content: z.string(),
  wordCount: z.number().int(),
  source: z.string().min(1),
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
    const { novelId, chapterId, content, wordCount, source, metadata } = parsed.data
    const meta = await getNovelMetaFromOSS(novelId)
    if (!meta?.chapters.some((c) => c.id === chapterId)) {
      return NextResponse.json({ success: false, error: '章节不存在' }, { status: 404 })
    }
    const revision = await db.chapterRevision.create({
      data: {
        novelId,
        chapterId,
        content,
        wordCount,
        source,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
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
      take: 50,
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

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { revisionId } = body
    if (!revisionId) {
      return NextResponse.json({ success: false, error: '缺少 revisionId' }, { status: 400 })
    }
    const revision = await db.chapterRevision.findUnique({
      where: { id: revisionId },
    })
    if (!revision) {
      return NextResponse.json({ success: false, error: '版本不存在' }, { status: 404 })
    }
    const { novelId, chapterId } = revision
    const currentContent = await getChapterContent(novelId, chapterId)
    const chMeta = (await getNovelMetaFromOSS(novelId))?.chapters.find((c) => c.id === chapterId)
    await db.chapterRevision.create({
      data: {
        novelId,
        chapterId,
        content: currentContent,
        wordCount: currentContent.length,
        source: 'restore',
        metadata: JSON.stringify({ restoredFrom: revisionId }),
      },
    })
    await saveChapterContent(novelId, chapterId, revision.content)
    await updateChapterInIndex(novelId, chapterId, {
      title: chMeta?.title ?? '章节',
      wordCount: revision.wordCount,
      order: chMeta?.order ?? 0,
      isPublished: chMeta?.isPublished ?? false,
    })
    await recomputeNovelWordCountFromOss(novelId)
    const chapter = {
      id: chapterId,
      novelId,
      title: chMeta?.title ?? '章节',
      content: revision.content,
      wordCount: revision.wordCount,
      order: chMeta?.order ?? 0,
      isPublished: chMeta?.isPublished ?? false,
      createdAt: chMeta?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    return NextResponse.json({ success: true, chapter })
  } catch (error) {
    console.error('Restore revision error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to restore revision' },
      { status: 500 }
    )
  }
}
