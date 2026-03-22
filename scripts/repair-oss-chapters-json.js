/**
 * 根据 OSS 上已有的 chapters/*.txt 重建并上传 chapters.json（并可选更新 novel.json 总字数）
 *
 * 用法:
 *   node scripts/repair-oss-chapters-json.js [novelId] [--dry-run]
 *
 * 示例:
 *   node scripts/repair-oss-chapters-json.js cmmzyca2x003il501c1d4fwtt
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

async function listAllChapterTxtKeys(client, novelId) {
  const prefix = `novels/${novelId}/chapters/`
  const keys = []
  let marker
  do {
    const params = { prefix, 'max-keys': 1000 }
    if (marker) params.marker = marker
    const result = await client.list(params)
    if (result.objects) {
      for (const o of result.objects) {
        if (o.name && o.name.endsWith('.txt')) keys.push(o.name)
      }
    }
    marker = result.nextMarker
  } while (marker)
  return keys
}

function chapterIdFromKey(key, novelId) {
  const base = `novels/${novelId}/chapters/`
  return key.slice(base.length).replace(/\.txt$/, '')
}

function guessTitle(content, orderIndex) {
  const line = (content || '').split(/\r?\n/).find((l) => l.trim().length > 0)
  if (line && line.trim().length <= 80 && line.trim().length >= 2) {
    return line.trim().replace(/^#+\s*/, '').slice(0, 80)
  }
  return `第${orderIndex + 1}章`
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run')
  const dryRun = process.argv.includes('--dry-run')
  const novelId = args[0] || 'cmmzyca2x003il501c1d4fwtt'

  const region = process.env.OSS_REGION || 'oss-cn-beijing'
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID || ''
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || ''
  const bucket = process.env.OSS_BUCKET || ''

  if (!accessKeyId || !accessKeySecret || !bucket) {
    console.error('缺少 OSS 环境变量')
    process.exit(1)
  }

  const client = new OSS({ region, accessKeyId, accessKeySecret, bucket })
  const prefix = `novels/${novelId}/`

  let novelMeta
  try {
    const r = await client.get(`${prefix}novel.json`)
    novelMeta = JSON.parse(r.content.toString('utf-8'))
  } catch (e) {
    console.error('无法读取 novel.json:', e.message)
    process.exit(2)
  }

  const txtKeys = await listAllChapterTxtKeys(client, novelId)
  txtKeys.sort((a, b) => chapterIdFromKey(a, novelId).localeCompare(chapterIdFromKey(b, novelId)))

  if (txtKeys.length === 0) {
    console.error('该目录下没有 chapters/*.txt，无法重建索引')
    process.exit(3)
  }

  const now = new Date().toISOString()
  const createdAtFallback = novelMeta.createdAt || now
  const chapters = []

  for (let i = 0; i < txtKeys.length; i++) {
    const key = txtKeys[i]
    const chapterId = chapterIdFromKey(key, novelId)
    const body = (await client.get(key)).content.toString('utf-8')
    const wordCount = body.length
    chapters.push({
      id: chapterId,
      title: guessTitle(body, i),
      wordCount,
      order: i,
      isPublished: true,
      createdAt: createdAtFallback,
      updatedAt: now,
    })
  }

  const totalWords = chapters.reduce((s, ch) => s + ch.wordCount, 0)
  const indexPath = `${prefix}chapters.json`
  const indexBody = JSON.stringify(chapters, null, 2)

  console.log('novelId:', novelId)
  console.log('title:', novelMeta.title)
  console.log('chapters/*.txt 数量:', txtKeys.length)
  console.log('将写入:', indexPath)
  console.log('novel.json wordCount 将更新为:', totalWords, '(原:', novelMeta.wordCount, ')')

  if (dryRun) {
    console.log('\n[--dry-run] 未上传。前 2 条索引预览:')
    console.log(JSON.stringify(chapters.slice(0, 2), null, 2))
    return
  }

  await client.put(indexPath, Buffer.from(indexBody, 'utf-8'))

  const newNovelMeta = {
    ...novelMeta,
    wordCount: totalWords,
    updatedAt: now,
  }
  await client.put(
    `${prefix}novel.json`,
    Buffer.from(JSON.stringify(newNovelMeta, null, 2), 'utf-8')
  )

  console.log('已上传 chapters.json 并更新 novel.json')
}

main().catch((e) => {
  console.error(e)
  process.exit(4)
})
