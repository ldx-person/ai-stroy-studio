import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { clearAllChaptersFromNovelOSS, isOSSAvailable } from '@/lib/oss'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

const bodySchema = z.object({
  confirm: z.literal(true),
})

/**
 * POST：清空该书 OSS 上全部章节（空 chapters.json、删 chapters/*.txt、全书字数归零），并删除本地该书的章节修订历史。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isOSSAvailable()) {
    return NextResponse.json({ success: false, error: 'OSS 未配置' }, { status: 503 })
  }

  const { id: novelId } = await params
  if (!novelId?.trim()) {
    return NextResponse.json({ success: false, error: '无效小说 ID' }, { status: 400 })
  }

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: '无效 JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: '危险操作：请在请求体中传入 { "confirm": true }' },
      { status: 400 }
    )
  }

  try {
    const result = await clearAllChaptersFromNovelOSS(novelId.trim())
    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result.error ?? '清空失败',
          deletedTxtCount: result.deletedTxtCount,
        },
        { status: 500 }
      )
    }

    await db.chapterRevision.deleteMany({ where: { novelId: novelId.trim() } })

    return NextResponse.json({
      success: true,
      deletedTxtCount: result.deletedTxtCount,
      message: `已清空章节索引与正文（删除 ${result.deletedTxtCount} 个 .txt），全书字数已归零；本地修订历史已清除`,
    })
  } catch (e) {
    console.error('clear-chapters:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : '清空失败' },
      { status: 500 }
    )
  }
}
