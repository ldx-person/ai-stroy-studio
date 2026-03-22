/**
 * 从 OSS 打印每本小说的 novel.json 与 chapters.json，便于与前端列表对照
 * node scripts/oss-audit-novel-list.js
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
const client = new OSS({
  region: process.env.OSS_REGION || 'oss-cn-beijing',
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET,
})

async function main() {
  const prefixes = []
  let marker
  do {
    const p = { prefix: 'novels/', delimiter: '/', 'max-keys': 1000 }
    if (marker) p.marker = marker
    const r = await client.list(p)
    if (r.prefixes) prefixes.push(...r.prefixes)
    marker = r.nextMarker
  } while (marker)

  const rows = []
  for (const pref of prefixes) {
    const id = pref.replace(/^novels\//, '').replace(/\/$/, '')
    let novel = {}
    let chapterCount = 0
    let sumChWordCount = 0
    try {
      novel = JSON.parse((await client.get(`${pref}novel.json`)).content.toString('utf8'))
    } catch (e) {
      novel = { id, title: '(novel.json 失败)', error: e.message }
    }
    try {
      const ch = JSON.parse((await client.get(`${pref}chapters.json`)).content.toString('utf8'))
      if (Array.isArray(ch)) {
        chapterCount = ch.length
        sumChWordCount = ch.reduce((s, c) => s + (typeof c.wordCount === 'number' ? c.wordCount : 0), 0)
      }
    } catch {
      chapterCount = -1
    }
    rows.push({
      id,
      title: novel.title,
      novelJsonWordCount: novel.wordCount,
      chaptersJsonCount: chapterCount,
      sumChapterIndexWordCount: sumChWordCount,
      match: chapterCount >= 0 && novel.wordCount === sumChWordCount,
    })
  }
  rows.sort((a, b) => (b.novelJsonWordCount || 0) - (a.novelJsonWordCount || 0))
  console.log(JSON.stringify(rows, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
