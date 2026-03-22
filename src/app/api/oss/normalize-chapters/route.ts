import { NextRequest, NextResponse } from 'next/server'
import { isOSSAvailable, listOSSNovels, normalizeAndPersistChapterMeta } from '@/lib/oss'

export const runtime = 'nodejs'

/**
 * POST：归一化 chapters.json（补全 chapterNumber、剥离标题内「第N章」、order 连续化）并写回 OSS
 * Body: { novelId?: string }
 */
export async function POST(request: NextRequest) {
  if (!isOSSAvailable()) {
    return NextResponse.json({ success: false, error: 'OSS 未配置' }, { status: 503 })
  }
  try {
    const body = await request.json().catch(() => ({}))
    const novelId = typeof body?.novelId === 'string' ? body.novelId.trim() : ''

    if (novelId) {
      const r = await normalizeAndPersistChapterMeta(novelId)
      return NextResponse.json({ success: true, novelId, ...r })
    }

    const metas = await listOSSNovels()
    const results: Array<{ novelId: string; count: number; changed: boolean }> = []
    for (const m of metas) {
      const r = await normalizeAndPersistChapterMeta(m.id)
      results.push({ novelId: m.id, ...r })
    }
    return NextResponse.json({
      success: true,
      message: `已检查 ${results.length} 本`,
      results,
    })
  } catch (e) {
    console.error('normalize-chapters:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'normalize 失败' },
      { status: 500 }
    )
  }
}
