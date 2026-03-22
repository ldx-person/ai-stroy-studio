import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import {
  saveChapterContent,
  getChapterContent,
  updateChapterInIndex,
  removeChapterFromIndex,
  isOSSAvailable,
  getNovelMetaFromOSS,
} from '@/lib/oss'
import { countWordsFromText } from '@/lib/word-count'
import { normalizeChapterIndexEntries } from '@/lib/chapter-meta'
import { recomputeNovelWordCountFromOss } from '@/lib/novel-oss-helpers'
import { createChapterSchema, updateChapterSchema, validateOrError } from '@/lib/validations/novel'

export const runtime = 'nodejs'

async function buildChapterPayloadFromOss(novelId: string, chapterId: string, content: string) {
  const meta = await getNovelMetaFromOSS(novelId)
  if (!meta) return null
  const norm = normalizeChapterIndexEntries(meta.chapters)
  const row = norm.find((c) => c.id === chapterId)
  if (!row) return null
  return {
    id: chapterId,
    novelId,
    title: row.title,
    chapterNumber: row.chapterNumber!,
    content,
    wordCount: countWordsFromText(content),
    order: row.order,
    isPublished: row.isPublished,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isOSSAvailable()) {
      return NextResponse.json({ success: false, error: 'OSS 未配置' }, { status: 503 })
    }
    const body = await request.json()
    const validation = validateOrError(createChapterSchema, body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    const { novelId, title, order, content, chapterNumber: reqChapterNumber } = validation.data
    const chapterContent = content || ''
    const chapterId = randomUUID()
    const meta = await getNovelMetaFromOSS(novelId)
    const norm = normalizeChapterIndexEntries(meta?.chapters ?? [])
    const maxNum = norm.reduce((m, c) => Math.max(m, c.chapterNumber ?? 0), 0)
    const nextChapterNumber =
      reqChapterNumber != null && reqChapterNumber >= 1 ? reqChapterNumber : maxNum + 1
    const nextOrder = order ?? norm.length
    const now = new Date().toISOString()

    await saveChapterContent(novelId, chapterId, chapterContent)
    await updateChapterInIndex(novelId, chapterId, {
      title,
      chapterNumber: nextChapterNumber,
      wordCount: countWordsFromText(chapterContent),
      order: nextOrder,
      isPublished: false,
    })
    await recomputeNovelWordCountFromOss(novelId)

    const chapter =
      (await buildChapterPayloadFromOss(novelId, chapterId, chapterContent)) ?? {
        id: chapterId,
        novelId,
        title,
        chapterNumber: nextChapterNumber,
        content: chapterContent,
        wordCount: countWordsFromText(chapterContent),
        order: nextOrder,
        isPublished: false,
        createdAt: now,
        updatedAt: now,
      }

    return NextResponse.json({ success: true, chapter })
  } catch (error) {
    console.error('Failed to create chapter:', error)
    return NextResponse.json({ success: false, error: 'Failed to create chapter' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!isOSSAvailable()) {
      return NextResponse.json({ success: false, error: 'OSS 未配置' }, { status: 503 })
    }
    const body = await request.json()
    const validation = validateOrError(updateChapterSchema, body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    const { id, novelId, title, content, wordCount, chapterNumber } = validation.data
    const meta = await getNovelMetaFromOSS(novelId)
    const exists = meta?.chapters.some((c) => c.id === id)
    if (!exists) {
      return NextResponse.json({ success: false, error: 'Chapter not found' }, { status: 404 })
    }
    const chMeta = meta!.chapters.find((c) => c.id === id)!

    if (content !== undefined) {
      await saveChapterContent(novelId, id, content)
      await updateChapterInIndex(novelId, id, {
        title: title ?? chMeta.title,
        wordCount: countWordsFromText(content),
        order: chMeta.order,
        isPublished: chMeta.isPublished,
        ...(chapterNumber !== undefined ? { chapterNumber } : {}),
      })
    } else if (wordCount !== undefined && title === undefined && chapterNumber === undefined) {
      const stored = await getChapterContent(novelId, id)
      const actual = countWordsFromText(stored)
      await updateChapterInIndex(novelId, id, {
        title: chMeta.title,
        wordCount: actual,
        order: chMeta.order,
        isPublished: chMeta.isPublished,
      })
    } else if (title !== undefined || chapterNumber !== undefined) {
      await updateChapterInIndex(novelId, id, {
        title: title ?? chMeta.title,
        wordCount: chMeta.wordCount,
        order: chMeta.order,
        isPublished: chMeta.isPublished,
        ...(chapterNumber !== undefined ? { chapterNumber } : {}),
      })
    }

    await recomputeNovelWordCountFromOss(novelId)
    const bodyContent = content !== undefined ? content : await getChapterContent(novelId, id)
    const chapter = await buildChapterPayloadFromOss(novelId, id, bodyContent)
    if (!chapter) {
      return NextResponse.json({ success: false, error: 'Chapter not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true, chapter })
  } catch (error) {
    console.error('Failed to update chapter:', error)
    return NextResponse.json({ success: false, error: 'Failed to update chapter' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!isOSSAvailable()) {
      return NextResponse.json({ success: false, error: 'OSS 未配置' }, { status: 503 })
    }
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const novelId = searchParams.get('novelId')
    if (!id || !novelId) {
      return NextResponse.json(
        { success: false, error: 'Chapter ID and novelId are required' },
        { status: 400 }
      )
    }
    const meta = await getNovelMetaFromOSS(novelId)
    if (!meta?.chapters.some((c) => c.id === id)) {
      return NextResponse.json({ success: false, error: 'Chapter not found' }, { status: 404 })
    }
    await removeChapterFromIndex(novelId, id)
    await recomputeNovelWordCountFromOss(novelId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete chapter:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete chapter' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!isOSSAvailable()) {
      return NextResponse.json({ success: false, error: 'OSS 未配置' }, { status: 503 })
    }
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const novelId = searchParams.get('novelId')
    if (!id || !novelId) {
      return NextResponse.json(
        { success: false, error: 'id and novelId query params are required' },
        { status: 400 }
      )
    }
    const meta = await getNovelMetaFromOSS(novelId)
    const chMeta = meta?.chapters.find((c) => c.id === id)
    if (!chMeta) {
      return NextResponse.json({ success: false, error: 'Chapter not found' }, { status: 404 })
    }
    const fullContent = await getChapterContent(novelId, id)
    const chapter = await buildChapterPayloadFromOss(novelId, id, fullContent)
    if (!chapter) {
      return NextResponse.json({ success: false, error: 'Chapter not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true, chapter })
  } catch (error) {
    console.error('Failed to get chapter:', error)
    return NextResponse.json({ success: false, error: 'Failed to get chapter' }, { status: 500 })
  }
}
