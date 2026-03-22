import { NextRequest, NextResponse } from 'next/server'
import { deleteNovelFromOSS, isOSSAvailable } from '@/lib/oss'
import { loadNovelFullAsClient } from '@/lib/novel-oss-helpers'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isOSSAvailable()) {
      return NextResponse.json(
        { success: false, error: 'OSS 未配置' },
        { status: 503 }
      )
    }
    // 不内联全部章节正文：数百章时 JSON 极大，易导致响应截断/解析失败，表现为前端 chapters 丢失、目录空白
    const novel = await loadNovelFullAsClient(id, { loadBodies: false })
    if (!novel) {
      return NextResponse.json({ success: false, error: 'Novel not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true, novel })
  } catch (error) {
    console.error('Failed to fetch novel:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch novel' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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
