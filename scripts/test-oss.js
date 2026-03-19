/**
 * OSS 通信机制完整测试（独立脚本，不依赖 Next.js）
 * 测试所有 OSS 读写、存储、解析是否正确
 *
 * 使用方式：
 * 1. 在 .env.local 中配置 OSS 连接信息：
 *    OSS_REGION=oss-cn-beijing
 *    OSS_ACCESS_KEY_ID=your_access_key
 *    OSS_ACCESS_KEY_SECRET=your_secret
 *    OSS_BUCKET=your_bucket_name
 *
 * 2. 运行: node scripts/test-oss.js  或  bun scripts/test-oss.js
 *
 * 或使用项目 OSS 库的 API 测试（需先启动 dev server）：
 *   curl http://localhost:3000/api/oss/test
 */

const fs = require('fs')
const path = require('path')

// 加载 .env.local
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
const bucket = process.env.OSS_BUCKET || 'ai-story-stroe'

const TEST_NOVEL_ID = 'oss-test-' + Date.now()
const TEST_CHAPTER_ID = 'oss-test-ch-' + Date.now()

function log(...args) {
  console.log('[OSS Test]', ...args)
}

function logOk(msg) {
  console.log('[OSS Test] ✓', msg)
}

function logFail(msg, err) {
  console.error('[OSS Test] ✗', msg, err ? err.message || err : '')
}

async function runTests() {
  if (!accessKeyId || !accessKeySecret || !bucket) {
    console.error('OSS 配置不完整，请在 .env.local 中配置：')
    console.error('  OSS_ACCESS_KEY_ID')
    console.error('  OSS_ACCESS_KEY_SECRET')
    console.error('  OSS_BUCKET')
    process.exit(1)
  }

  log('配置:', { region, bucket, accessKeyId: accessKeyId ? accessKeyId.slice(0, 8) + '...' : '未配置' })
  log('测试小说ID:', TEST_NOVEL_ID)
  log('')

  let OSS
  let ossClient
  try {
    OSS = require('ali-oss')
    ossClient = new OSS({ region, accessKeyId, accessKeySecret, bucket })
  } catch (e) {
    console.error('无法加载 ali-oss，请先安装: npm install ali-oss')
    process.exit(1)
  }

  const NOVEL_PREFIX = 'novels'

  const tests = []
  let passed = 0
  let failed = 0

  // ========== 1. 基础连接测试 ==========
  try {
    const listResult = await ossClient.list({ prefix: NOVEL_PREFIX + '/', 'max-keys': 1 })
    logOk('OSS 连接成功')
    passed++
  } catch (e) {
    logFail('OSS 连接失败', e)
    failed++
    tests.push({ name: '连接', ok: false })
    await runReport()
    return
  }
  tests.push({ name: '连接', ok: true })

  // ========== 2. novel.json 元数据 ==========
  const novelMeta = {
    id: TEST_NOVEL_ID,
    title: 'OSS测试小说',
    genre: '测试',
    status: 'draft',
    wordCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  try {
    await ossClient.put(
      `${NOVEL_PREFIX}/${TEST_NOVEL_ID}/novel.json`,
      Buffer.from(JSON.stringify(novelMeta, null, 2), 'utf-8')
    )
    const getResult = await ossClient.get(`${NOVEL_PREFIX}/${TEST_NOVEL_ID}/novel.json`)
    const parsed = JSON.parse(getResult.content.toString('utf-8'))
    if (parsed.title !== novelMeta.title || parsed.id !== novelMeta.id) {
      throw new Error('解析结果不一致')
    }
    logOk('novel.json 写入与读取解析正确')
    passed++
    tests.push({ name: 'novel.json', ok: true })
  } catch (e) {
    logFail('novel.json 测试失败', e)
    failed++
    tests.push({ name: 'novel.json', ok: false })
  }

  // ========== 3. description.txt ==========
  const description = '这是一部OSS测试小说的简介，用于验证存储与读取。'
  try {
    await ossClient.put(
      `${NOVEL_PREFIX}/${TEST_NOVEL_ID}/description.txt`,
      Buffer.from(description, 'utf-8')
    )
    const getResult = await ossClient.get(`${NOVEL_PREFIX}/${TEST_NOVEL_ID}/description.txt`)
    const readDesc = getResult.content.toString('utf-8')
    if (readDesc !== description) {
      throw new Error('简介内容不一致')
    }
    logOk('description.txt 写入与读取正确')
    passed++
    tests.push({ name: 'description.txt', ok: true })
  } catch (e) {
    logFail('description.txt 测试失败', e)
    failed++
    tests.push({ name: 'description.txt', ok: false })
  }

  // ========== 4. outline.json ==========
  const outline = { beginning: '开头', middle: '经过', ending: '结尾' }
  try {
    await ossClient.put(
      `${NOVEL_PREFIX}/${TEST_NOVEL_ID}/outline.json`,
      Buffer.from(JSON.stringify(outline, null, 2), 'utf-8')
    )
    const getResult = await ossClient.get(`${NOVEL_PREFIX}/${TEST_NOVEL_ID}/outline.json`)
    const parsed = JSON.parse(getResult.content.toString('utf-8'))
    if (parsed.beginning !== outline.beginning) {
      throw new Error('大纲解析不一致')
    }
    logOk('outline.json 写入与读取解析正确')
    passed++
    tests.push({ name: 'outline.json', ok: true })
  } catch (e) {
    logFail('outline.json 测试失败', e)
    failed++
    tests.push({ name: 'outline.json', ok: false })
  }

  // ========== 5. chapters.json 索引 ==========
  const now = new Date().toISOString()
  const chaptersIndex = [
    {
      id: TEST_CHAPTER_ID,
      title: '第一章 测试',
      wordCount: 100,
      order: 0,
      isPublished: false,
      createdAt: now,
      updatedAt: now
    }
  ]
  try {
    await ossClient.put(
      `${NOVEL_PREFIX}/${TEST_NOVEL_ID}/chapters.json`,
      Buffer.from(JSON.stringify(chaptersIndex, null, 2), 'utf-8')
    )
    const getResult = await ossClient.get(`${NOVEL_PREFIX}/${TEST_NOVEL_ID}/chapters.json`)
    const parsed = JSON.parse(getResult.content.toString('utf-8'))
    if (!Array.isArray(parsed) || parsed[0].id !== TEST_CHAPTER_ID || parsed[0].order !== 0) {
      throw new Error('章节索引解析不一致')
    }
    logOk('chapters.json 索引写入与读取解析正确')
    passed++
    tests.push({ name: 'chapters.json', ok: true })
  } catch (e) {
    logFail('chapters.json 测试失败', e)
    failed++
    tests.push({ name: 'chapters.json', ok: false })
  }

  // ========== 6. 章节内容 chapters/{id}.txt ==========
  const chapterContent = '这是第一章的测试内容。\n\n用于验证章节内容是否正确存储和读取。包含中文和标点符号。'
  try {
    await ossClient.put(
      `${NOVEL_PREFIX}/${TEST_NOVEL_ID}/chapters/${TEST_CHAPTER_ID}.txt`,
      Buffer.from(chapterContent, 'utf-8')
    )
    const getResult = await ossClient.get(`${NOVEL_PREFIX}/${TEST_NOVEL_ID}/chapters/${TEST_CHAPTER_ID}.txt`)
    const readContent = getResult.content.toString('utf-8')
    if (readContent !== chapterContent) {
      throw new Error('章节内容不一致')
    }
    logOk('章节内容 chapters/{id}.txt 写入与读取正确')
    passed++
    tests.push({ name: 'chapters/{id}.txt', ok: true })
  } catch (e) {
    logFail('章节内容测试失败', e)
    failed++
    tests.push({ name: 'chapters/{id}.txt', ok: false })
  }

  // ========== 7. story_bible.json 作品档案 ==========
  const storyBible = { characters: [{ name: '测试角色' }], world: '测试世界观' }
  try {
    await ossClient.put(
      `${NOVEL_PREFIX}/${TEST_NOVEL_ID}/story_bible.json`,
      Buffer.from(JSON.stringify(storyBible, null, 2), 'utf-8')
    )
    const getResult = await ossClient.get(`${NOVEL_PREFIX}/${TEST_NOVEL_ID}/story_bible.json`)
    const parsed = JSON.parse(getResult.content.toString('utf-8'))
    if (parsed.characters[0].name !== '测试角色') {
      throw new Error('作品档案解析不一致')
    }
    logOk('story_bible.json 写入与读取解析正确')
    passed++
    tests.push({ name: 'story_bible.json', ok: true })
  } catch (e) {
    logFail('story_bible.json 测试失败', e)
    failed++
    tests.push({ name: 'story_bible.json', ok: false })
  }

  // ========== 8. list 目录列表（delimiter） ==========
  try {
    const listResult = await ossClient.list({
      prefix: `${NOVEL_PREFIX}/`,
      delimiter: '/',
      'max-keys': 1000
    })
    const prefixes = listResult.prefixes || []
    const hasTest = prefixes.some(p => p.includes(TEST_NOVEL_ID))
    if (!hasTest) {
      throw new Error('list 未找到测试小说目录')
    }
    logOk('list 目录列表（delimiter）正确')
    passed++
    tests.push({ name: 'list/delimiter', ok: true })
  } catch (e) {
    logFail('list 目录列表测试失败', e)
    failed++
    tests.push({ name: 'list/delimiter', ok: false })
  }

  // ========== 9. 更新章节索引（模拟 updateChapterInIndex） ==========
  try {
    const getResult = await ossClient.get(`${NOVEL_PREFIX}/${TEST_NOVEL_ID}/chapters.json`)
    let chapters = JSON.parse(getResult.content.toString('utf-8'))
    const idx = chapters.findIndex(ch => ch.id === TEST_CHAPTER_ID)
    if (idx >= 0) {
      chapters[idx] = { ...chapters[idx], wordCount: 200, updatedAt: new Date().toISOString() }
    }
    chapters.sort((a, b) => a.order - b.order)
    await ossClient.put(
      `${NOVEL_PREFIX}/${TEST_NOVEL_ID}/chapters.json`,
      Buffer.from(JSON.stringify(chapters, null, 2), 'utf-8')
    )
    const getResult2 = await ossClient.get(`${NOVEL_PREFIX}/${TEST_NOVEL_ID}/chapters.json`)
    const parsed = JSON.parse(getResult2.content.toString('utf-8'))
    if (parsed[idx].wordCount !== 200) {
      throw new Error('更新后索引内容不一致')
    }
    logOk('updateChapterInIndex 逻辑更新与读取正确')
    passed++
    tests.push({ name: 'updateChapterInIndex', ok: true })
  } catch (e) {
    logFail('updateChapterInIndex 测试失败', e)
    failed++
    tests.push({ name: 'updateChapterInIndex', ok: false })
  }

  // ========== 10. 完整读取流程（模拟 getNovelFromOSS） ==========
  try {
    const metaResult = await ossClient.get(`${NOVEL_PREFIX}/${TEST_NOVEL_ID}/novel.json`)
    const meta = JSON.parse(metaResult.content.toString('utf-8'))
    const descResult = await ossClient.get(`${NOVEL_PREFIX}/${TEST_NOVEL_ID}/description.txt`)
    const descriptionRead = descResult.content.toString('utf-8')
    const chaptersIndexResult = await ossClient.get(`${NOVEL_PREFIX}/${TEST_NOVEL_ID}/chapters.json`)
    const chaptersIndexRead = JSON.parse(chaptersIndexResult.content.toString('utf-8'))
    const chapterContentResult = await ossClient.get(
      `${NOVEL_PREFIX}/${TEST_NOVEL_ID}/chapters/${chaptersIndexRead[0].id}.txt`
    )
    const chapterContentRead = chapterContentResult.content.toString('utf-8')
    if (meta.title !== novelMeta.title || descriptionRead !== description || chapterContentRead !== chapterContent) {
      throw new Error('完整读取流程数据不一致')
    }
    logOk('完整读取流程（getNovelFromOSS 模拟）正确')
    passed++
    tests.push({ name: '完整读取流程', ok: true })
  } catch (e) {
    logFail('完整读取流程测试失败', e)
    failed++
    tests.push({ name: '完整读取流程', ok: false })
  }

  // ========== 11. 清理测试数据 ==========
  try {
    const listResult = await ossClient.list({ prefix: `${NOVEL_PREFIX}/${TEST_NOVEL_ID}/` })
    const files = (listResult.objects || []).map(o => o.name)
    if (files.length > 0) {
      await ossClient.deleteMulti(files)
    }
    logOk('测试数据已清理')
    passed++
    tests.push({ name: '清理', ok: true })
  } catch (e) {
    logFail('清理测试数据失败', e)
    failed++
    tests.push({ name: '清理', ok: false })
  }

  await runReport()

  async function runReport() {
    log('')
    log('========== 测试报告 ==========')
    log(`通过: ${passed} | 失败: ${failed}`)
    tests.forEach(t => {
      console.log(`  ${t.ok ? '✓' : '✗'} ${t.name}`)
    })
    log('============================')
    if (failed > 0) {
      process.exit(1)
    }
  }
}

runTests().catch(e => {
  console.error('测试异常:', e)
  process.exit(1)
})
