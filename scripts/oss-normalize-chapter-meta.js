/**
 * 归一化 OSS chapters.json：chapterNumber、标题去前缀、order 连续
 *   node scripts/oss-normalize-chapter-meta.js
 *   node scripts/oss-normalize-chapter-meta.js <novelId>
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

// 与 src/lib/chapter-meta.ts 保持行为一致（精简复制，避免跑 ts）
const RE_CHAPTER_ARABIC = /^第\s*(\d+)\s*章\s*[、:：.\s\-—]*\s*(.*)$/su
const RE_CHAPTER_CN_SINGLE = /^第\s*([一二三四五六七八九])\s*章\s*[、:：.\s\-—]*\s*(.*)$/su
const RE_CHAPTER_TEEN = /^第\s*(十[一二三四五六七八九]?)\s*章\s*[、:：.\s\-—]*\s*(.*)$/su
const RE_CHAPTER_DOT = /^(\d+)\s*[、.．]\s*(.+)$/su
const CN_ONE_DIGIT = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const PLACEHOLDER_TITLE = '（无标题）'

function parseChineseTeen(s) {
  const t = s.trim()
  if (t === '十') return 10
  if (t.startsWith('十') && t.length === 2) {
    const u = CN_ONE_DIGIT[t[1]]
    return u != null ? 10 + u : null
  }
  return null
}

function parseLegacyChapterTitle(raw) {
  const s = raw.trim()
  if (!s) return null
  let m = s.match(RE_CHAPTER_ARABIC)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 1) return { chapterNumber: n, titleRest: (m[2] || '').trim() }
  }
  m = s.match(RE_CHAPTER_TEEN)
  if (m) {
    const n = parseChineseTeen(m[1])
    if (n != null && n >= 1) return { chapterNumber: n, titleRest: (m[2] || '').trim() }
  }
  m = s.match(RE_CHAPTER_CN_SINGLE)
  if (m) {
    const n = CN_ONE_DIGIT[m[1]]
    if (n != null) return { chapterNumber: n, titleRest: (m[2] || '').trim() }
  }
  m = s.match(RE_CHAPTER_DOT)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 1) return { chapterNumber: n, titleRest: (m[2] || '').trim() }
  }
  return null
}

function normalizeChapterIndexEntries(chapters) {
  const sorted = [...chapters].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return sorted.map((ch, index) => {
    const fromField =
      typeof ch.chapterNumber === 'number' && Number.isFinite(ch.chapterNumber) && ch.chapterNumber >= 1
        ? Math.floor(ch.chapterNumber)
        : null
    const parsed = parseLegacyChapterTitle(ch.title || '')
    const chapterNumber = fromField ?? parsed?.chapterNumber ?? index + 1
    let title = (ch.title || '').trim()
    if (parsed && (fromField == null || parsed.chapterNumber === fromField)) {
      title = parsed.titleRest.trim()
    } else if (fromField != null) {
      const again = parseLegacyChapterTitle(title)
      if (again && again.chapterNumber === fromField) title = again.titleRest.trim()
    }
    if (!title) title = PLACEHOLDER_TITLE
    return { ...ch, order: index, chapterNumber, title }
  })
}

const OSS = require('ali-oss')

async function listNovelIds(client) {
  const ids = []
  let marker
  do {
    const p = { prefix: 'novels/', delimiter: '/', 'max-keys': 1000 }
    if (marker) p.marker = marker
    const r = await client.list(p)
    if (r.prefixes) {
      for (const pref of r.prefixes) ids.push(pref.replace(/^novels\//, '').replace(/\/$/, ''))
    }
    marker = r.nextMarker
  } while (marker)
  return ids
}

async function normalizeOne(client, novelId) {
  const prefix = `novels/${novelId}/`
  let chapters = []
  try {
    const result = await client.get(`${prefix}chapters.json`)
    const parsed = JSON.parse(result.content.toString('utf-8'))
    chapters = Array.isArray(parsed) ? parsed : []
  } catch {
    return { novelId, count: 0, changed: false, skipped: true }
  }
  const before = JSON.stringify(chapters)
  const next = normalizeChapterIndexEntries(chapters)
  const after = JSON.stringify(next)
  const changed = before !== after
  if (changed) {
    await client.put(`${prefix}chapters.json`, Buffer.from(JSON.stringify(next, null, 2), 'utf-8'))
  }
  return { novelId, count: next.length, changed }
}

async function main() {
  const singleId = process.argv[2]?.trim()
  const client = new OSS({
    region: process.env.OSS_REGION || 'oss-cn-beijing',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket: process.env.OSS_BUCKET,
  })
  if (singleId) {
    console.log(JSON.stringify(await normalizeOne(client, singleId), null, 2))
    return
  }
  const ids = await listNovelIds(client)
  const all = []
  for (const id of ids) all.push(await normalizeOne(client, id))
  console.log(JSON.stringify({ count: all.length, results: all }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
