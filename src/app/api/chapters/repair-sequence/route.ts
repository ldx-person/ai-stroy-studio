import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isOSSAvailable, repairChapterSequenceToMatchReadingOrder } from '@/lib/oss'

export const runtime = 'nodejs'

const bodySchema = z.object({
  novelId: z.string().min(1),
  confirm: z.literal(true),
})

/**
 * POST 按当前 order 阅读顺序，将 chapterNumber 修复为 1..n、order 为 0..n-1，并剥离标题内遗留「第N章」前缀
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

  try {
    const result = await repairChapterSequenceToMatchReadingOrder(parsed.data.novelId)
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error ?? '修复失败', updatedCount: result.updatedCount },
        { status: 409 }
      )
    }
    return NextResponse.json({
      success: true,
      updatedCount: result.updatedCount,
      message: `已按阅读顺序重排章号（共 ${result.updatedCount} 章），标题中的旧「第N章」前缀已剥离`,
    })
  } catch (e) {
    console.error('repair-sequence:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : '修复失败' },
      { status: 500 }
    )
  }
}
