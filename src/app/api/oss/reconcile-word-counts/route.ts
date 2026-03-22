import { NextRequest, NextResponse } from 'next/server'
import {
  isOSSAvailable,
  listOSSNovels,
  reconcileChapterWordCountsWithFiles,
} from '@/lib/oss'

export const runtime = 'nodejs'

/**
 * POST：按各章 .txt 重写 chapters.json 的 wordCount，并同步 novel.json。
 * Body: { novelId?: string } — 省略则处理 bucket 内全部小说（慎用，书多会较慢）
 */
export async function POST(request: NextRequest) {
  if (!isOSSAvailable()) {
    return NextResponse.json({ success: false, error: 'OSS 未配置' }, { status: 503 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const novelId = typeof body?.novelId === 'string' ? body.novelId.trim() : ''

    if (novelId) {
      const result = await reconcileChapterWordCountsWithFiles(novelId)
      return NextResponse.json({ success: true, novelId, ...result })
    }

    const metas = await listOSSNovels()
    const results: Array<
      { novelId: string } & {
        chaptersChecked: number
        entriesUpdated: number
        totalWordCount: number
      }
    > = []
    for (const m of metas) {
      const r = await reconcileChapterWordCountsWithFiles(m.id)
      results.push({ novelId: m.id, ...r })
    }
    return NextResponse.json({
      success: true,
      message: `已处理 ${results.length} 本小说`,
      results,
    })
  } catch (e) {
    console.error('reconcile-word-counts:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'reconcile 失败' },
      { status: 500 }
    )
  }
}
