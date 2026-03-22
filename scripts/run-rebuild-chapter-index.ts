/**
 * 调用与 API 一致的 rebuildChapterIndexFromOssTxtFiles（读 .env.local）
 *
 * 用法:
 *   npx tsx scripts/run-rebuild-chapter-index.ts <novelId>
 *   npx tsx scripts/run-rebuild-chapter-index.ts --all
 *   npx tsx scripts/run-rebuild-chapter-index.ts <novelId> --dry-run
 */
import fs from 'fs'
import path from 'path'
import {
  rebuildChapterIndexFromOssTxtFiles,
  isOSSAvailable,
  listOSSNovels,
} from '@/lib/oss'

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
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

loadEnvLocal()

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run')
  const dryRun = process.argv.includes('--dry-run')

  if (!isOSSAvailable()) {
    console.error('OSS 未配置：请检查 .env.local 中 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET')
    process.exit(1)
  }

  if (args[0] === '--all') {
    const novels = await listOSSNovels()
    console.log(`共 ${novels.length} 本小说，按正文重建索引…\n`)
    let ok = 0
    let skip = 0
    let fail = 0
    for (const n of novels) {
      const r = await rebuildChapterIndexFromOssTxtFiles(n.id, { dryRun })
      if (r.ok) {
        ok++
        console.log(
          `[OK] ${n.id} · ${n.title} · ${r.chapterCount} 章 · 总字 ${r.totalWordCount}${dryRun ? ' (dry-run)' : ''}`
        )
      } else if (r.chapterCount === 0 && (r.error || '').includes('.txt')) {
        skip++
        console.log(`[SKIP] ${n.id} · ${n.title} — ${r.error}`)
      } else {
        fail++
        console.error(`[FAIL] ${n.id} · ${n.title} — ${r.error}`)
      }
    }
    console.log(`\n完成: 成功 ${ok}, 跳过 ${skip}, 失败 ${fail}`)
    if (fail > 0) process.exit(2)
    return
  }

  const novelId = args[0]
  if (!novelId) {
    console.error('用法: npx tsx scripts/run-rebuild-chapter-index.ts <novelId> [--dry-run]')
    console.error('  或: npx tsx scripts/run-rebuild-chapter-index.ts --all [--dry-run]')
    process.exit(1)
  }

  const r = await rebuildChapterIndexFromOssTxtFiles(novelId, { dryRun })
  if (!r.ok) {
    console.error('失败:', r.error)
    process.exit(2)
  }
  console.log(JSON.stringify({ ...r, preview: r.preview?.length }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(4)
})
