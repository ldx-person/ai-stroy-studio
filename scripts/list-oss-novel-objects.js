/** 列出 novels/{id}/ 下所有对象。用法: node scripts/list-oss-novel-objects.js <novelId> */
const fs = require('fs')
const path = require('path')
const envPath = path.resolve(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^[\"']|[\"']$/g, '')
  }
}
const OSS = require('ali-oss')
const id = process.argv[2] || 'cmmzyca2x003il501c1d4fwtt'
const client = new OSS({
  region: process.env.OSS_REGION || 'oss-cn-beijing',
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET,
})
;(async () => {
  const prefix = `novels/${id}/`
  let marker
  const names = []
  do {
    const p = { prefix, 'max-keys': 1000 }
    if (marker) p.marker = marker
    const r = await client.list(p)
    if (r.objects) names.push(...r.objects.map((o) => o.name))
    marker = r.nextMarker
  } while (marker)
  console.log('count:', names.length)
  names.sort().forEach((n) => console.log(n))
})()
