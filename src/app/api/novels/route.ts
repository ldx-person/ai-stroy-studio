import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { saveNovelToOSS, deleteNovelFromOSS, isOSSAvailable, updateNovelMeta } from '@/lib/oss'
import { listClientNovelsFromOss } from '@/lib/novel-oss-helpers'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  try {
    if (!isOSSAvailable()) {
      return NextResponse.json({
        success: true,
        novels: [],
        message: 'OSS 未配置，无法加载作品（OSS 为唯一数据源）',
      })
    }
    const novels = await listClientNovelsFromOss()
    return NextResponse.json({ success: true, novels })
  } catch (error) {
    console.error('Failed to fetch novels:', error)
    const details =
      process.env.NODE_ENV === 'development' && error instanceof Error
        ? error.message
        : undefined
    return NextResponse.json(
      { success: false, error: 'Failed to fetch novels', details },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isOSSAvailable()) {
      return NextResponse.json(
        { success: false, error: 'OSS 未配置，无法创建作品' },
        { status: 503 }
      )
    }
    const { createNovelSchema, validateOrError } = await import('@/lib/validations/novel')
    const body = await request.json()
    const validation = validateOrError(createNovelSchema, body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    const { title, description, genre } = validation.data
    const id = randomUUID()
    const now = new Date().toISOString()
    await saveNovelToOSS(id, {
      title,
      genre: genre ?? null,
      status: 'draft',
      wordCount: 0,
      description: description || undefined,
    })
    const novel = {
      id,
      title,
      description: description || null,
      cover: null,
      genre: genre ?? null,
      status: 'draft',
      wordCount: 0,
      chapters: [],
      createdAt: now,
      updatedAt: now,
    }
    return NextResponse.json({ success: true, novel })
  } catch (error) {
    console.error('Failed to create novel:', error)
    return NextResponse.json({ success: false, error: 'Failed to create novel' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!isOSSAvailable()) {
      return NextResponse.json(
        { success: false, error: 'OSS 未配置' },
        { status: 503 }
      )
    }
    const { updateNovelSchema, validateOrError } = await import('@/lib/validations/novel')
    const body = await request.json()
    const validation = validateOrError(updateNovelSchema, body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    const { id, status, title, description, genre } = validation.data
    const patch: Parameters<typeof updateNovelMeta>[1] = {}
    if (title !== undefined) patch.title = title
    if (genre !== undefined) patch.genre = genre
    if (status !== undefined) patch.status = status
    if (Object.keys(patch).length) await updateNovelMeta(id, patch)

    if (description !== undefined && description) {
      const client = (await import('ali-oss')).default
      const ossClient = new client({
        region: process.env.OSS_REGION || 'oss-cn-beijing',
        accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
        accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
        bucket: process.env.OSS_BUCKET || 'ai-story-stroe',
      })
      await ossClient.put(`novels/${id}/description.txt`, Buffer.from(description, 'utf-8'))
    }

    const { loadNovelFullAsClient } = await import('@/lib/novel-oss-helpers')
    const novel = await loadNovelFullAsClient(id, { loadBodies: false })
    if (!novel) {
      return NextResponse.json({ success: false, error: '小说不存在' }, { status: 404 })
    }
    return NextResponse.json({ success: true, novel })
  } catch (error) {
    console.error('Failed to update novel:', error)
    return NextResponse.json({ success: false, error: 'Failed to update novel' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 })
    }
    if (isOSSAvailable()) {
      try {
        await deleteNovelFromOSS(id)
      } catch (error) {
        console.error('Failed to delete OSS files:', error)
      }
    }
    await db.chapterRevision.deleteMany({ where: { novelId: id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete novel:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete novel' }, { status: 500 })
  }
}
