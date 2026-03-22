/**
 * 将源小说的 chapters.json 与全部 chapters/*.txt 拷贝到目标小说（同 Bucket 内 OSS copy）
 *
 * 用法:
 *   node scripts/clone-oss-novel-chapters.js <fromNovelId> <toNovelId> [--dry-run]
 *
 * 示例（补全空目录的《剑指星河》副本）:
 *   node scripts/clone-oss-novel-chapters.js cmmzyelb0003nl501b8h7mhm2 cmmzyca2x003il501c1d4fwtt
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

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run')
  const [fromId, toId] = args

  if (!fromId || !toId) {
    console.error(
      '用法: node scripts/clone-oss-novel-chapters.js <fromNovelId> <toNovelId> [--dry-run]'
    )
    process.exit(1)
  }

  const region = process.env.OSS_REGION || 'oss-cn-beijing'
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID || ''
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || ''
  const bucket = process.env.OSS_BUCKET || ''

  if (!accessKeyId || !accessKeySecret || !bucket) {
    console.error('缺少 OSS 环境变量')
    process.exit(1)
  }

  const client = new OSS({ region, accessKeyId, accessKeySecret, bucket })
  const fromPrefix = `novels/${fromId}/`
  const toPrefix = `novels/${toId}/`

  let indexRaw
  try {
    const r = await client.get(`${fromPrefix}chapters.json`)
    indexRaw = r.content.toString('utf-8')
  } catch (e) {
    console.error('源小说缺少 chapters.json:', e.message)
    process.exit(2)
  }

  let chapters
  try {
    chapters = JSON.parse(indexRaw)
  } catch (e) {
    console.error('源 chapters.json 非合法 JSON:', e.message)
    process.exit(2)
  }

  if (!Array.isArray(chapters) || chapters.length === 0) {
    console.error('源 chapters.json 为空或非数组')
    process.exit(2)
  }

  const now = new Date().toISOString()
  const chaptersUpdated = chapters.map((ch) => ({
    ...ch,
    updatedAt: now,
  }))
  const newIndexBody = JSON.stringify(chaptersUpdated, null, 2)

  console.log('from:', fromId)
  console.log('to:', toId)
  console.log('章节数:', chapters.length)
  if (dryRun) {
    console.log('[--dry-run] 将 copy', chapters.length, '个 .txt + 上传 chapters.json')
    return
  }

  for (const ch of chapters) {
    if (!ch.id) continue
    const src = `${fromPrefix}chapters/${ch.id}.txt`
    const dest = `${toPrefix}chapters/${ch.id}.txt`
    const body = (await client.get(src)).content
    await client.put(dest, body)
    process.stdout.write('.')
  }
  console.log('')

  await client.put(`${toPrefix}chapters.json`, Buffer.from(newIndexBody, 'utf-8'))

  let toMeta
  try {
    const r = await client.get(`${toPrefix}novel.json`)
    toMeta = JSON.parse(r.content.toString('utf-8'))
  } catch (e) {
    console.error('目标 novel.json 读取失败:', e.message)
    process.exit(3)
  }

  let fromMeta
  try {
    const r = await client.get(`${fromPrefix}novel.json`)
    fromMeta = JSON.parse(r.content.toString('utf-8'))
  } catch {
    fromMeta = {}
  }

  const totalWords =
    typeof fromMeta.wordCount === 'number'
      ? fromMeta.wordCount
      : chapters.reduce((s, c) => s + (typeof c.wordCount === 'number' ? c.wordCount : 0), 0)

  const newNovelMeta = {
    ...toMeta,
    wordCount: totalWords,
    updatedAt: now,
  }
  await client.put(
    `${toPrefix}novel.json`,
    Buffer.from(JSON.stringify(newNovelMeta, null, 2), 'utf-8')
  )

  console.log('完成: 已拷贝全部章节正文、chapters.json，并更新目标 novel.json wordCount =', totalWords)
}

main().catch((e) => {
  console.error(e)
  process.exit(4)
})
