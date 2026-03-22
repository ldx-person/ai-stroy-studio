import { NextResponse } from 'next/server'
import {
  isOSSAvailable,
  listOSSNovels,
  getNovelMetaFromOSS,
  getNovelFromOSS,
  getChapterContent
} from '@/lib/oss'

type NovelReport = {
  id: string
  title: string
  listOSSNovelsMetaOk: boolean
  listMetaIssues: string[]
  getNovelMetaOk: boolean
  metaIssues: string[]
  descriptionLen: number | null
  chaptersInIndex: number
  chapterIndexIssues: string[]
  getNovelFullOk?: boolean
  fullIssues?: string[]
  chaptersWithContent?: number
  chaptersMissingTxt?: number
  sampleChapterReadOk?: boolean
}

function validateNovelMeta(meta: { id?: string; title?: string; genre?: unknown; status?: string; wordCount?: unknown; createdAt?: string; updatedAt?: string }): string[] {
  const issues: string[] = []
  if (!meta.id) issues.push('novel.json 缺少 id')
  if (!meta.title) issues.push('novel.json 缺少 title')
  if (meta.status == null) issues.push('novel.json 缺少 status')
  if (typeof meta.wordCount !== 'number') issues.push('novel.json wordCount 非数字')
  return issues
}

function validateChapterIndexEntry(ch: Record<string, unknown>, i: number): string[] {
  const issues: string[] = []
  if (!ch.id || typeof ch.id !== 'string') issues.push(`chapters[${i}] 缺少有效 id`)
  if (ch.order != null && typeof ch.order !== 'number') issues.push(`chapters[${i}] order 非数字`)
  if (ch.wordCount != null && typeof ch.wordCount !== 'number') issues.push(`chapters[${i}] wordCount 非数字`)
  return issues
}

/**
 * GET - 只读验证：OSS 结构与 lib/oss 读取、解析是否与预期一致（不写数据库）
 */
export async function GET() {
  if (!isOSSAvailable()) {
    return NextResponse.json({
      success: false,
      error: 'OSS 未配置（需 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET）'
    }, { status: 500 })
  }

  const summary = {
    listOSSNovelsCount: 0,
    novelsChecked: 0,
    fullReadSampleCount: 0,
    allListMetaOk: true,
    allMetaOk: true,
    allFullOk: true
  }

  const reports: NovelReport[] = []
  const globalIssues: string[] = []

  try {
    const ossNovels = await listOSSNovels()
    summary.listOSSNovelsCount = ossNovels.length

    if (ossNovels.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'OSS 已连接，但 novels/ 下暂无小说（listOSSNovels 为空）',
        summary,
        reports: [],
        globalIssues
      })
    }

    const maxMetaCheck = Math.min(ossNovels.length, 20)
    const fullReadFirstN = 2

    for (let n = 0; n < maxMetaCheck; n++) {
      const meta = ossNovels[n]
      const listIssues = validateNovelMeta(meta)
      const report: NovelReport = {
        id: meta.id,
        title: meta.title,
        listOSSNovelsMetaOk: listIssues.length === 0,
        listMetaIssues: listIssues,
        getNovelMetaOk: false,
        metaIssues: [],
        descriptionLen: null,
        chaptersInIndex: 0,
        chapterIndexIssues: []
      }
      if (listIssues.length) summary.allListMetaOk = false

      const metaData = await getNovelMetaFromOSS(meta.id)
      if (!metaData) {
        report.metaIssues.push('getNovelMetaFromOSS 返回 null')
        summary.allMetaOk = false
      } else {
        report.descriptionLen = metaData.description?.length ?? 0
        report.chaptersInIndex = metaData.chapters.length
        metaData.chapters.forEach((ch, i) => {
          const chIssues = validateChapterIndexEntry(ch as unknown as Record<string, unknown>, i)
          report.chapterIndexIssues.push(...chIssues)
        })
        report.getNovelMetaOk = report.chapterIndexIssues.length === 0 && report.metaIssues.length === 0
        if (!report.getNovelMetaOk) summary.allMetaOk = false
      }

      if (n < fullReadFirstN) {
        summary.fullReadSampleCount++
        const full = await getNovelFromOSS(meta.id)
        report.fullIssues = []
        if (!full) {
          report.getNovelFullOk = false
          report.fullIssues!.push('getNovelFromOSS 返回 null')
          summary.allFullOk = false
        } else {
          if (full.meta.id !== meta.id) {
            report.fullIssues!.push('完整读取 meta.id 与列表不一致')
            summary.allFullOk = false
          }
          const idxCount = full.chapters.length
          let withContent = 0
          let missingTxt = 0
          for (const ch of full.chapters) {
            if (ch.content && ch.content.length > 0) withContent++
            else missingTxt++
          }
          report.chaptersWithContent = withContent
          report.chaptersMissingTxt = missingTxt
          report.getNovelFullOk = report.fullIssues!.length === 0
          if (metaData && metaData.chapters.length !== idxCount) {
            report.fullIssues!.push(
              `章节数不一致: getNovelMeta 索引 ${metaData.chapters.length} vs getNovelFull 合并后 ${idxCount}`
            )
            summary.allFullOk = false
            report.getNovelFullOk = false
          }
          if (full.chapters[0]?.id) {
            const expected = full.chapters[0].content ?? ''
            const raw = await getChapterContent(meta.id, full.chapters[0].id)
            report.sampleChapterReadOk = raw === expected
            if (!report.sampleChapterReadOk && expected.length > 0) {
              report.fullIssues!.push(
                `getChapterContent 与 getNovelFromOSS 首章正文不一致（长度 OSS单读=${raw.length} vs 全量=${expected.length}）`
              )
              summary.allFullOk = false
            }
          }
        }
      }

      reports.push(report)
      summary.novelsChecked++
    }

    if (ossNovels.length > maxMetaCheck) {
      globalIssues.push(`仅详细检查了前 ${maxMetaCheck} 本小说，共 ${ossNovels.length} 本`)
    }

    const success =
      summary.allListMetaOk &&
      summary.allMetaOk &&
      (summary.fullReadSampleCount === 0 || summary.allFullOk)

    return NextResponse.json({
      success,
      message: success
        ? 'OSS 读取与解析校验通过（抽样）'
        : '存在结构或解析问题，见各 report.issues',
      summary,
      reports,
      globalIssues,
      syncLogicNote:
        '架构已切换为 OSS 唯一真相源；GET /api/oss/sync 为兼容占位。作品数据见 OSS novels/{id}/；修订历史在 SQLite chapter_revisions'
    })
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : '验证异常',
        summary,
        reports,
        globalIssues
      },
      { status: 500 }
    )
  }
}
