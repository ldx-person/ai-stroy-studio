import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isOSSAvailable, rebuildChapterIndexFromOssTxtFiles } from '@/lib/oss'

export const runtime = 'nodejs'

const bodySchema = z.object({
  novelId: z.string().min(1),
  /** 非 dryRun 时必须为 true，防止误触 */
  confirm: z.literal(true).optional(),
  dryRun: z.boolean().optional(),
})

/**
 * POST：按 OSS 上 novels/{novelId}/chapters/*.txt 全量重建 chapters.json，并同步 novel.json 字数。
 * Body: { novelId, confirm: true } | { novelId, dryRun: true }
 */
export async function POST(request: NextRequest) {
  if (!isOSSAvailable()) {
    return NextResponse.json({ success: false, error: 'OSS 未配置' }, { status: 503 })
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
      { success: false, error: parsed.error.issues[0]?.message ?? '参数无效' },
      { status: 400 }
    )
  }

  const { novelId, confirm, dryRun } = parsed.data
  if (!dryRun && confirm !== true) {
    return NextResponse.json(
      {
        success: false,
        error: '全量重建会覆盖 chapters.json，请传 confirm: true；或传 dryRun: true 仅预览',
      },
      { status: 400 }
    )
  }

  try {
    const result = await rebuildChapterIndexFromOssTxtFiles(novelId, { dryRun: !!dryRun })
    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result.error ?? '重建失败',
          chapterCount: result.chapterCount,
          totalWordCount: result.totalWordCount,
        },
        { status: 409 }
      )
    }
    return NextResponse.json({
      success: true,
      dryRun: !!dryRun,
      chapterCount: result.chapterCount,
      totalWordCount: result.totalWordCount,
      preview: result.preview,
      message: dryRun
        ? `预览：将根据 ${result.chapterCount} 个 .txt 生成索引，总字数约 ${result.totalWordCount}`
        : `已根据 OSS 正文重建索引（${result.chapterCount} 章），novel.json 字数已同步`,
    })
  } catch (e) {
    console.error('rebuild-chapter-index:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : '重建失败' },
      { status: 500 }
    )
  }
}
