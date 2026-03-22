/**
 * 按 OSS 上各章 .txt 实际长度重写 chapters.json.wordCount，并写回 novel.json
 *   node scripts/oss-reconcile-word-counts.js           # 全部小说
 *   node scripts/oss-reconcile-word-counts.js <novelId> # 单本
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

function countWordsFromText(text) {
  return text.length
}

async function listNovelIds(client) {
  const ids = []
  let marker
  do {
    const p = { prefix: 'novels/', delimiter: '/', 'max-keys': 1000 }
    if (marker) p.marker = marker
    const r = await client.list(p)
    if (r.prefixes) {
      for (const pref of r.prefixes) {
        ids.push(pref.replace(/^novels\//, '').replace(/\/$/, ''))
      }
    }
    marker = r.nextMarker
  } while (marker)
  return ids
}

async function reconcileOne(client, novelId) {
  const prefix = `novels/${novelId}/`
  let chapters = []
  try {
    const result = await client.get(`${prefix}chapters.json`)
    const parsed = JSON.parse(result.content.toString('utf-8'))
    chapters = Array.isArray(parsed) ? parsed : []
  } catch {
    return { novelId, chaptersChecked: 0, entriesUpdated: 0, totalWordCount: 0, skipped: true }
  }

  let entriesUpdated = 0
  const next = []
  for (const ch of chapters) {
    if (!ch?.id) continue
    let len = 0
    try {
      const r = await client.get(`${prefix}chapters/${ch.id}.txt`)
      len = countWordsFromText(r.content.toString('utf-8'))
    } catch {
      len = 0
    }
    const prev = typeof ch.wordCount === 'number' ? ch.wordCount : 0
    if (len !== prev) entriesUpdated++
    next.push({ ...ch, wordCount: len })
  }
  next.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  await client.put(`${prefix}chapters.json`, Buffer.from(JSON.stringify(next, null, 2), 'utf-8'))

  const totalWordCount = next.reduce((s, ch) => s + (typeof ch.wordCount === 'number' ? ch.wordCount : 0), 0)

  let novelMeta
  try {
    const nr = await client.get(`${prefix}novel.json`)
    novelMeta = JSON.parse(nr.content.toString('utf-8'))
  } catch {
    novelMeta = { id: novelId, title: novelId, genre: null, status: 'draft', createdAt: new Date().toISOString() }
  }
  novelMeta.wordCount = totalWordCount
  novelMeta.updatedAt = new Date().toISOString()
  await client.put(`${prefix}novel.json`, Buffer.from(JSON.stringify(novelMeta, null, 2), 'utf-8'))

  return { novelId, chaptersChecked: next.length, entriesUpdated, totalWordCount }
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
    const r = await reconcileOne(client, singleId)
    console.log(JSON.stringify(r, null, 2))
    return
  }

  const ids = await listNovelIds(client)
  const all = []
  for (const id of ids) {
    all.push(await reconcileOne(client, id))
  }
  console.log(JSON.stringify({ count: all.length, results: all }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
