import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  isOSSAvailable,
  deleteOrphanChapterTxtFiles,
  deleteOrphanChapterTxtFilesForAllNovels,
} from '@/lib/oss'

export const runtime = 'nodejs'

const bodySchema = z.object({
  /** 指定小说 id；与 all 二选一 */
  novelId: z.string().min(1).optional(),
  /** 为 true 时对 listOSSNovels 中每本执行清理 */
  all: z.boolean().optional(),
  /** 必须为 true，防止误触 */
  confirm: z.literal(true),
  /**
   * chapters.json 无有效 id 时是否仍删除全部「孤儿」.txt（会清空该书全部正文，极危险）
   */
  allowWhenIndexEmpty: z.boolean().optional(),
})

/**
 * POST 删除 OSS 孤儿章节正文：有 chapters/{id}.txt 但 chapters.json 中无该 id
 * body: { novelId, confirm: true } | { all: true, confirm: true }
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

  const { novelId, all, confirm: _c, allowWhenIndexEmpty } = parsed.data
  const n = novelId ? 1 : 0
  const a = all ? 1 : 0
  if (n + a !== 1) {
    return NextResponse.json(
      { success: false, error: '必须且仅能指定 novelId 或 all: true 之一' },
      { status: 400 }
    )
  }

  const opts = { allowWhenIndexEmpty: allowWhenIndexEmpty === true }

  try {
    if (novelId) {
      const result = await deleteOrphanChapterTxtFiles(novelId, opts)
      return NextResponse.json({
        success: true,
        scope: 'single',
        result,
      })
    }

    const { results } = await deleteOrphanChapterTxtFilesForAllNovels(opts)
    const totalDeleted = results.reduce((s, r) => s + r.deletedKeys.length, 0)
    const blocked = results.filter((r) => r.blockedReason)
    return NextResponse.json({
      success: true,
      scope: 'all',
      summary: {
        novelsProcessed: results.length,
        totalDeletedKeys: totalDeleted,
        blockedCount: blocked.length,
      },
      results,
    })
  } catch (e) {
    console.error('clean-orphan-chapters:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : '清理失败' },
      { status: 500 }
    )
  }
}
