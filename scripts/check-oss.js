/**
 * 检查 OSS 是否已配置，并列举 novels/ 下是否有数据
 * 运行: node scripts/check-oss.js
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

const region = process.env.OSS_REGION || 'oss-cn-beijing'
const accessKeyId = process.env.OSS_ACCESS_KEY_ID || ''
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || ''
const bucket = process.env.OSS_BUCKET || ''

console.log('======== OSS 配置检查 ========')
console.log('OSS_REGION:', region || '(未设置，将用 oss-cn-beijing)')
console.log('OSS_BUCKET:', bucket || '(未设置)')
console.log(
  'OSS_ACCESS_KEY_ID:',
  accessKeyId ? `${accessKeyId.slice(0, 6)}…${accessKeyId.slice(-4)}` : '(未设置)'
)
console.log('OSS_ACCESS_KEY_SECRET:', accessKeySecret ? '(已设置)' : '(未设置)')

const ok = !!(accessKeyId && accessKeySecret && bucket)
console.log('\n配置结论:', ok ? '已配置完整，可连接 OSS' : '未配置完整，请在 .env.local 填写 OSS_* 变量')
console.log('============================\n')

if (!ok) {
  process.exit(1)
}

const OSS = require('ali-oss')
const client = new OSS({ region, accessKeyId, accessKeySecret, bucket })

async function main() {
  try {
    await client.getBucketInfo()
    console.log('连接 Bucket: 成功\n')
  } catch (e) {
    console.error('连接 Bucket 失败:', e.message || e)
    process.exit(2)
  }

  const prefixes = []
  let marker
  do {
    const result = await client.list({
      prefix: 'novels/',
      delimiter: '/',
      'max-keys': 1000,
      marker
    })
    if (result.prefixes) prefixes.push(...result.prefixes)
    marker = result.nextMarker
  } while (marker)

  console.log('======== OSS 数据（novels/）========')
  console.log('小说目录数量:', prefixes.length)

  if (prefixes.length === 0) {
    console.log('当前 Bucket 下 novels/ 下暂无子目录（可能尚未同步小说到 OSS）')
    console.log('==================================')
    return
  }

  const sample = prefixes.slice(0, 15)
  console.log('前若干本小说目录:')
  for (const p of sample) {
    const id = p.replace(/^novels\//, '').replace(/\/$/, '')
    let title = '(无 novel.json 或读取失败)'
    try {
      const r = await client.get(`${p}novel.json`)
      const meta = JSON.parse(r.content.toString('utf-8'))
      title = meta.title || id
    } catch {
      // ignore
    }
    console.log(`  - ${id.slice(0, 12)}… → ${title}`)
  }
  if (prefixes.length > sample.length) {
    console.log(`  … 共 ${prefixes.length} 本，仅展示前 ${sample.length} 本`)
  }
  console.log('==================================')
}

main().catch((e) => {
  console.error(e)
  process.exit(3)
})
