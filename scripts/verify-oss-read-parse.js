/**
 * 离线验证 OSS 目录结构与读取/解析（不经过 Next，等价于 GET /api/oss/verify 的主要检查）
 * 运行: node scripts/verify-oss-read-parse.js
 */
const fs = require('fs')
const path = require('path')

const envPath = path.resolve(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
      process.env[key] = val
    }
  }
}

const OSS = require('ali-oss')

function validateNovelMeta(meta) {
  const issues = []
  if (!meta.id) issues.push('novel.json 缺少 id')
  if (!meta.title) issues.push('novel.json 缺少 title')
  if (meta.status == null) issues.push('novel.json 缺少 status')
  if (typeof meta.wordCount !== 'number') issues.push('novel.json wordCount 非数字')
  return issues
}

function validateChapterIndexEntry(ch, i) {
  const issues = []
  if (!ch.id || typeof ch.id !== 'string') issues.push(`chapters[${i}] 缺少有效 id`)
  if (ch.order != null && typeof ch.order !== 'number') issues.push(`chapters[${i}] order 非数字`)
  if (ch.wordCount != null && typeof ch.wordCount !== 'number') issues.push(`chapters[${i}] wordCount 非数字`)
  return issues
}

async function main() {
  const region = process.env.OSS_REGION || 'oss-cn-beijing'
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID || ''
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || ''
  const bucket = process.env.OSS_BUCKET || ''

  if (!accessKeyId || !accessKeySecret || !bucket) {
    console.error(JSON.stringify({ success: false, error: 'OSS 未配置' }, null, 2))
    process.exit(1)
  }

  const client = new OSS({ region, accessKeyId, accessKeySecret, bucket })
  const summary = {
    listOSSNovelsCount: 0,
    novelsChecked: 0,
    fullReadSampleCount: 0,
    allListMetaOk: true,
    allMetaOk: true,
    allFullOk: true,
  }
  const reports = []
  const globalIssues = []

  const prefixes = []
  let marker
  do {
    const params = { prefix: 'novels/', delimiter: '/', 'max-keys': 1000 }
    if (marker) params.marker = marker
    const result = await client.list(params)
    if (result.prefixes) prefixes.push(...result.prefixes)
    marker = result.nextMarker
  } while (marker)

  const novels = []
  const CONCURRENCY = 10
  for (let i = 0; i < prefixes.length; i += CONCURRENCY) {
    const batch = prefixes.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map(async (p) => {
        const buf = (await client.get(`${p}novel.json`)).content.toString('utf8')
        return JSON.parse(buf)
      })
    )
    for (const r of settled) {
      if (r.status === 'fulfilled') novels.push(r.value)
    }
  }
  novels.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
  summary.listOSSNovelsCount = novels.length

  if (novels.length === 0) {
    console.log(
      JSON.stringify(
        {
          success: true,
          message: 'OSS 已连接，但 novels/ 下暂无小说',
          summary,
          reports: [],
          globalIssues,
        },
        null,
        2
      )
    )
    return
  }

  const maxMetaCheck = Math.min(novels.length, 20)
  const fullReadFirstN = 2

  for (let n = 0; n < maxMetaCheck; n++) {
    const meta = novels[n]
    const id = meta.id
    const prefix = `novels/${id}/`
    const listIssues = validateNovelMeta(meta)
    const report = {
      id,
      title: meta.title,
      listOSSNovelsMetaOk: listIssues.length === 0,
      listMetaIssues: listIssues,
      getNovelMetaOk: false,
      metaIssues: [],
      descriptionLen: null,
      chaptersInIndex: 0,
      chapterIndexIssues: [],
    }
    if (listIssues.length) summary.allListMetaOk = false

    let chapters = []
    let description = null
    try {
      const descResult = await client.get(`${prefix}description.txt`)
      description = descResult.content.toString('utf-8')
    } catch {
      /* optional */
    }
    try {
      const chaptersIndexResult = await client.get(`${prefix}chapters.json`)
      const parsed = JSON.parse(chaptersIndexResult.content.toString('utf-8'))
      chapters = Array.isArray(parsed) ? parsed : []
      chapters.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    } catch (e) {
      report.metaIssues.push(`chapters.json 读取失败: ${e.message}`)
      summary.allMetaOk = false
    }

    report.descriptionLen = description != null ? description.length : 0
    report.chaptersInIndex = chapters.length
    chapters.forEach((ch, idx) => {
      report.chapterIndexIssues.push(...validateChapterIndexEntry(ch, idx))
    })
    report.getNovelMetaOk = report.metaIssues.length === 0 && report.chapterIndexIssues.length === 0
    if (!report.getNovelMetaOk) summary.allMetaOk = false

    if (n < fullReadFirstN) {
      summary.fullReadSampleCount++
      report.fullIssues = []
      let idxCount = 0
      let withContent = 0
      let missingTxt = 0
      const fullChapters = []
      for (const ch of chapters) {
        if (!ch?.id) continue
        idxCount++
        let content = ''
        try {
          const contentResult = await client.get(`${prefix}chapters/${ch.id}.txt`)
          content = contentResult.content.toString('utf-8')
        } catch {
          missingTxt++
        }
        if (content && content.length > 0) withContent++
        fullChapters.push({ ...ch, content })
      }
      report.chaptersWithContent = withContent
      report.chaptersMissingTxt = missingTxt
      if (chapters.length !== idxCount) {
        report.fullIssues.push(`有效章节 id 数 ${idxCount} 与索引条数 ${chapters.length} 不一致（含无效 id）`)
        summary.allFullOk = false
      }
      if (fullChapters[0]?.id) {
        let raw = ''
        try {
          const r = await client.get(`${prefix}chapters/${fullChapters[0].id}.txt`)
          raw = r.content.toString('utf-8')
        } catch {
          /* empty */
        }
        const expected = fullChapters[0].content ?? ''
        report.sampleChapterReadOk = raw === expected
        if (!report.sampleChapterReadOk && expected.length > 0) {
          report.fullIssues.push(
            `getChapterContent 与全量首章不一致（单读长度=${raw.length} vs 全量=${expected.length}）`
          )
          summary.allFullOk = false
        }
      }
      report.getNovelFullOk = report.fullIssues.length === 0
      if (!report.getNovelFullOk) summary.allFullOk = false
    }

    reports.push(report)
    summary.novelsChecked++
  }

  if (novels.length > maxMetaCheck) {
    globalIssues.push(`仅详细检查了前 ${maxMetaCheck} 本小说，共 ${novels.length} 本`)
  }

  const success =
    summary.allListMetaOk &&
    summary.allMetaOk &&
    (summary.fullReadSampleCount === 0 || summary.allFullOk)

  const out = {
    success,
    message: success ? 'OSS 读取与解析校验通过（离线脚本抽样）' : '存在结构或解析问题，见各 report',
    summary,
    reports,
    globalIssues,
    syncLogicNote:
      'GET /api/oss/sync 使用 listOSSNovels + getNovelMetaFromOSS；DB 中章节 content 多为空，正文按需从 OSS 拉取',
    note:
      '若本机 Next /api 无响应，可用本脚本代替 GET /api/oss/verify；可尝试 next dev --webpack 排查 Turbopack。',
  }
  console.log(JSON.stringify(out, null, 2))
  process.exit(success ? 0 : 2)
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: String(e.message || e) }, null, 2))
  process.exit(3)
})
