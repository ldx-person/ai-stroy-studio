/**
 * 删除 OSS 孤儿章节 .txt：文件存在于 novels/{id}/chapters/ 但 chapters.json 无对应 id
 *
 * 用法：
 *   node scripts/oss-delete-orphan-chapter-txt.js <novelId>
 *   node scripts/oss-delete-orphan-chapter-txt.js --all
 *
 * 若 chapters.json 无任何有效章节 id 仍存在 .txt，默认**拒绝**删除（防误删全书）。
 * 强行清空：加环境变量 OSS_ORPHAN_ALLOW_EMPTY_INDEX=1
 *
 * 需 .env.local 中 OSS 配置（同其他 oss 脚本）
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

function parseIndexIds(buf) {
  const text = buf.toString('utf-8').replace(/^\uFEFF/, '')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
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

async function deleteOrphansForNovel(client, novelId, allowWhenIndexEmpty) {
  const prefix = `novels/${novelId}/`
  const chapterPrefix = `${prefix}chapters/`
  let indexIds = []
  try {
    const cr = await client.get(`${prefix}chapters.json`)
    const parsed = parseIndexIds(cr.content)
    if (parsed === null) {
      return { novelId, deletedKeys: [], errors: ['chapters.json JSON 解析失败'], blocked: true }
    }
    indexIds = parsed
  } catch (e) {
    return { novelId, deletedKeys: [], errors: [`chapters.json: ${e.message}`], blocked: true }
  }

  const uniqueSet = new Set(indexIds)
  let objects = []
  try {
    objects = await listAllObjects(client, chapterPrefix)
  } catch (e) {
    return { novelId, deletedKeys: [], errors: [`list: ${e.message}`], blocked: true }
  }

  const txtIds = []
  for (const o of objects) {
    if (!o.name.endsWith('.txt')) continue
    const rel = o.name.slice(chapterPrefix.length)
    const id = rel.replace(/\.txt$/i, '')
    if (id) txtIds.push(id)
  }

  const orphans = txtIds.filter((id) => !uniqueSet.has(id))

  if (uniqueSet.size === 0 && orphans.length > 0 && !allowWhenIndexEmpty) {
    return {
      novelId,
      deletedKeys: [],
      errors: [],
      blocked: true,
      blockedReason: 'index_has_no_valid_ids',
      orphanCount: orphans.length,
    }
  }

  const deletedKeys = []
  const errors = []
  for (const id of orphans) {
    const key = `${chapterPrefix}${id}.txt`
    try {
      await client.delete(key)
      deletedKeys.push(key)
    } catch (e) {
      errors.push(`${key}: ${e.message}`)
    }
  }
  return { novelId, deletedKeys, errors, orphanCount: orphans.length, blocked: false }
}

async function main() {
  const args = process.argv.slice(2)
  const all = args.includes('--all')
  const novelId = args.find((a) => !a.startsWith('--'))
  const allowWhenIndexEmpty = process.env.OSS_ORPHAN_ALLOW_EMPTY_INDEX === '1'

  if (!all && !novelId) {
    console.error('用法: node scripts/oss-delete-orphan-chapter-txt.js <novelId>')
    console.error('   或: node scripts/oss-delete-orphan-chapter-txt.js --all')
    process.exit(1)
  }
  if (all && novelId) {
    console.error('不要同时使用 --all 与 novelId')
    process.exit(1)
  }

  if (!process.env.OSS_ACCESS_KEY_ID || !process.env.OSS_ACCESS_KEY_SECRET || !process.env.OSS_BUCKET) {
    console.error('缺少 OSS 环境变量')
    process.exit(1)
  }

  const client = new OSS({
    region: process.env.OSS_REGION || 'oss-cn-beijing',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket: process.env.OSS_BUCKET,
  })

  if (all) {
    const prefixes = await listNovelPrefixes(client)
    const out = []
    for (const pref of prefixes) {
      const id = pref.replace(/^novels\//, '').replace(/\/$/, '')
      out.push(await deleteOrphansForNovel(client, id, allowWhenIndexEmpty))
    }
    console.log(JSON.stringify({ results: out }, null, 2))
    const fail = out.some((r) => r.errors?.length || r.blocked)
    process.exit(fail ? 2 : 0)
  }

  const r = await deleteOrphansForNovel(client, novelId, allowWhenIndexEmpty)
  console.log(JSON.stringify(r, null, 2))
  if (r.blocked && r.blockedReason) process.exit(3)
  if (r.errors?.length) process.exit(2)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
