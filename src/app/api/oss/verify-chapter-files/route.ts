import { NextRequest, NextResponse } from 'next/server'
import {
  isOSSAvailable,
  verifyNovelChapterIndexVsTxtFiles,
  verifyAllNovelsChapterIndexVsTxtFiles,
} from '@/lib/oss'

export const runtime = 'nodejs'

/**
 * GET ?novelId=xxx 校验单本；无参数则校验 listOSSNovels 中全部小说
 * 对照：chapters.json 条目数 vs novels/{id}/chapters/*.txt 数量，并列出缺文件/孤儿文件/重复 id
 */
export async function GET(request: NextRequest) {
  if (!isOSSAvailable()) {
    return NextResponse.json(
      { success: false, error: 'OSS 未配置' },
      { status: 503 }
    )
  }

  try {
    const novelId = request.nextUrl.searchParams.get('novelId')?.trim()
    if (novelId) {
      const report = await verifyNovelChapterIndexVsTxtFiles(novelId)
      return NextResponse.json({
        success: true,
        scope: 'single',
        report,
      })
    }

    const { summary, reports } = await verifyAllNovelsChapterIndexVsTxtFiles()
    return NextResponse.json({
      success: true,
      scope: 'all',
      summary,
      reports,
    })
  } catch (e) {
    console.error('verify-chapter-files:', e)
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : '校验失败',
      },
      { status: 500 }
    )
  }
}
