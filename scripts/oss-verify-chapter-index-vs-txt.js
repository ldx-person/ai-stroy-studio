/**
 * 校验 OSS：chapters.json 索引条数 vs novels/{id}/chapters/*.txt 文件数是否一致
 * 逻辑与 src/lib/oss.ts verifyNovelChapterIndexVsTxtFiles 对齐（纯 Node，无需 tsx）
 *
 * 用法：
 *   node scripts/oss-verify-chapter-index-vs-txt.js           # 全部小说
 *   node scripts/oss-verify-chapter-index-vs-txt.js <novelId> # 单本
 *
 * 需 .env.local 中 OSS_REGION / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET
 */
const fs = require('fs')
const path = require('path')
const envPath = path.resolve(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}

const OSS = require('ali-oss')

function chaptersJsonParsedToRawArray(parsed) {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.chapters)) return parsed.chapters
    if (Array.isArray(parsed.data)) return parsed.data
  }
  return []
}

function coerceId(raw) {
  if (raw == null || typeof raw !== 'object') return ''
  const idRaw = raw.id ?? raw.chapterId ?? raw.uuid ?? raw.chapter_id
  if (typeof idRaw === 'string' && idRaw.trim()) return idRaw.trim()
  if (typeof idRaw === 'number' && Number.isFinite(idRaw)) return String(Math.trunc(idRaw))
  return ''
}

function parseChaptersIndexFromBody(buf) {
  const text = buf.toString('utf-8').replace(/^\uFEFF/, '')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const rawList = chaptersJsonParsedToRawArray(parsed)
  const ids = []
  for (const raw of rawList) {
    const id = coerceId(raw)
    if (id) ids.push(id)
  }
  return ids
}

async function listAllObjects(client, prefix) {
  const all = []
  let marker
  do {
    const p = { prefix, 'max-keys': 1000 }
    if (marker) p.marker = marker
    const r = await client.list(p)
    if (r.objects) all.push(...r.objects)
    marker = r.nextMarker
  } while (marker)
  return all
}

async function listNovelPrefixes(client) {
  const prefixes = []
  let marker
  do {
    const p = { prefix: 'novels/', delimiter: '/', 'max-keys': 1000 }
    if (marker) p.marker = marker
    const r = await client.list(p)
    if (r.prefixes) prefixes.push(...r.prefixes)
    marker = r.nextMarker
  } while (marker)
  return prefixes
}

async function verifyNovel(client, novelId) {
  const prefix = `novels/${novelId}/`
  const chapterPrefix = `${prefix}chapters/`
  let title = novelId
  try {
    const nr = await client.get(`${prefix}novel.json`)
    const m = JSON.parse(nr.content.toString('utf8'))
    if (m.title) title = m.title
  } catch (_) {}

  let indexIds = []
  try {
    const cr = await client.get(`${prefix}chapters.json`)
    indexIds = parseChaptersIndexFromBody(cr.content)
  } catch (e) {
    return {
      novelId,
      title,
      error: `chapters.json: ${e.message}`,
      indexEntryCount: 0,
      txtFileCount: 0,
      rawCountMatch: false,
      fullyConsistent: false,
    }
  }

  const idCounts = new Map()
  for (const id of indexIds) idCounts.set(id, (idCounts.get(id) || 0) + 1)
  const duplicateIndexIds = [...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id)
  const uniqueSet = new Set(indexIds)

  let objects = []
  try {
    objects = await listAllObjects(client, chapterPrefix)
  } catch (e) {
    return {
      novelId,
      title,
      error: `list chapters/: ${e.message}`,
      indexEntryCount: indexIds.length,
      uniqueIndexIdCount: uniqueSet.size,
      txtFileCount: 0,
      duplicateIndexIds,
      missingTxtForIndexId: [...uniqueSet],
      orphanTxtIds: [],
      rawCountMatch: false,
      fullyConsistent: false,
    }
  }

  const txtIds = []
  for (const o of objects) {
    if (!o.name.endsWith('.txt')) continue
    const rel = o.name.slice(chapterPrefix.length)
    if (!rel) continue
    const id = rel.replace(/\.txt$/i, '')
    if (id) txtIds.push(id)
  }
  const txtSet = new Set(txtIds)
  const missingTxtForIndexId = [...uniqueSet].filter((id) => !txtSet.has(id))
  const orphanTxtIds = txtIds.filter((id) => !uniqueSet.has(id))
  const rawCountMatch = indexIds.length === txtIds.length
  const fullyConsistent =
    duplicateIndexIds.length === 0 &&
    missingTxtForIndexId.length === 0 &&
    orphanTxtIds.length === 0 &&
    rawCountMatch

  return {
    novelId,
    title,
    indexEntryCount: indexIds.length,
    uniqueIndexIdCount: uniqueSet.size,
    txtFileCount: txtIds.length,
    duplicateIndexIds,
    missingTxtForIndexId,
    orphanTxtIds,
    rawCountMatch,
    fullyConsistent,
  }
}

async function main() {
  const singleId = process.argv[2]?.trim()
  const client = new OSS({
    region: process.env.OSS_REGION || 'oss-cn-beijing',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket: process.env.OSS_BUCKET,
  })

  if (!process.env.OSS_ACCESS_KEY_ID || !process.env.OSS_ACCESS_KEY_SECRET || !process.env.OSS_BUCKET) {
    console.error('缺少 OSS 环境变量，请配置 .env.local')
    process.exit(1)
  }

  if (singleId) {
    const r = await verifyNovel(client, singleId)
    console.log(JSON.stringify(r, null, 2))
    process.exit(r.fullyConsistent ? 0 : 2)
  }

  const prefixes = await listNovelPrefixes(client)
  const reports = []
  for (const pref of prefixes) {
    const id = pref.replace(/^novels\//, '').replace(/\/$/, '')
    reports.push(await verifyNovel(client, id))
  }
  const ok = reports.filter((r) => r.fullyConsistent).length
  const summary = {
    novelCount: reports.length,
    fullyConsistentCount: ok,
    mismatchCount: reports.length - ok,
  }
  console.log(JSON.stringify({ summary, reports }, null, 2))
  process.exit(summary.mismatchCount > 0 ? 2 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
