import { NextResponse } from 'next/server'
import {
  isOSSAvailable,
  saveNovelToOSS,
  getNovelFromOSS,
  getNovelMetaFromOSS,
  saveChapterContent,
  getChapterContent,
  updateChapterInIndex,
  removeChapterFromIndex,
  saveStoryBibleToOSS,
  getStoryBibleFromOSS,
  updateNovelMeta,
  listOSSNovels,
  deleteNovelFromOSS
} from '@/lib/oss'

const TEST_NOVEL_ID = 'oss-api-test-' + Date.now()
const TEST_CHAPTER_ID = 'oss-api-ch-' + Date.now()

interface TestResult {
  name: string
  ok: boolean
  error?: string
}

export async function GET() {
  const results: TestResult[] = []

  if (!isOSSAvailable()) {
    return NextResponse.json({
      success: false,
      error: 'OSS 配置不可用，请检查 .env.local 中的 OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET、OSS_BUCKET',
      results: []
    }, { status: 500 })
  }

  try {
    // 1. saveNovelToOSS + getNovelFromOSS
    try {
      await saveNovelToOSS(TEST_NOVEL_ID, {
        title: 'OSS API 测试小说',
        genre: '测试',
        status: 'draft',
        wordCount: 0,
        description: '测试简介内容',
        outline: { beginning: '开头', middle: '经过', ending: '结尾' },
        chapters: [
          {
            id: TEST_CHAPTER_ID,
            title: '第一章 测试',
            wordCount: 50,
            order: 0,
            isPublished: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            content: '这是第一章的测试内容，用于验证 OSS 存储与读取。'
          }
        ]
      })
      const novel = await getNovelFromOSS(TEST_NOVEL_ID)
      if (!novel || novel.meta.title !== 'OSS API 测试小说' || novel.chapters[0]?.content !== '这是第一章的测试内容，用于验证 OSS 存储与读取。') {
        throw new Error('数据不一致')
      }
      results.push({ name: 'saveNovelToOSS + getNovelFromOSS', ok: true })
    } catch (e) {
      results.push({ name: 'saveNovelToOSS + getNovelFromOSS', ok: false, error: String(e) })
    }

    // 2. getNovelMetaFromOSS
    try {
      const meta = await getNovelMetaFromOSS(TEST_NOVEL_ID)
      if (!meta || !meta.description || meta.chapters.length !== 1) {
        throw new Error('元数据不完整')
      }
      results.push({ name: 'getNovelMetaFromOSS', ok: true })
    } catch (e) {
      results.push({ name: 'getNovelMetaFromOSS', ok: false, error: String(e) })
    }

    // 3. saveChapterContent + getChapterContent
    try {
      const newContent = '更新后的章节内容，包含更多文字。'
      await saveChapterContent(TEST_NOVEL_ID, TEST_CHAPTER_ID, newContent)
      const readContent = await getChapterContent(TEST_NOVEL_ID, TEST_CHAPTER_ID)
      if (readContent !== newContent) {
        throw new Error('章节内容不一致')
      }
      results.push({ name: 'saveChapterContent + getChapterContent', ok: true })
    } catch (e) {
      results.push({ name: 'saveChapterContent + getChapterContent', ok: false, error: String(e) })
    }

    // 4. updateChapterInIndex
    try {
      await updateChapterInIndex(TEST_NOVEL_ID, TEST_CHAPTER_ID, { wordCount: 999, title: '第一章 已更新' })
      const novel = await getNovelFromOSS(TEST_NOVEL_ID)
      const ch = novel?.chapters.find(c => c.id === TEST_CHAPTER_ID)
      if (!ch || ch.wordCount !== 999 || ch.title !== '第一章 已更新') {
        throw new Error('索引更新后读取不一致')
      }
      results.push({ name: 'updateChapterInIndex', ok: true })
    } catch (e) {
      results.push({ name: 'updateChapterInIndex', ok: false, error: String(e) })
    }

    // 5. saveStoryBibleToOSS + getStoryBibleFromOSS
    try {
      const storyBible = { characters: [{ name: '测试角色' }] }
      await saveStoryBibleToOSS(TEST_NOVEL_ID, storyBible)
      const read = await getStoryBibleFromOSS(TEST_NOVEL_ID)
      if (!read || (read as { characters?: { name: string }[] }).characters?.[0]?.name !== '测试角色') {
        throw new Error('作品档案不一致')
      }
      results.push({ name: 'saveStoryBibleToOSS + getStoryBibleFromOSS', ok: true })
    } catch (e) {
      results.push({ name: 'saveStoryBibleToOSS + getStoryBibleFromOSS', ok: false, error: String(e) })
    }

    // 6. updateNovelMeta
    try {
      await updateNovelMeta(TEST_NOVEL_ID, { wordCount: 1234, status: 'ongoing' })
      const novel = await getNovelFromOSS(TEST_NOVEL_ID)
      if (!novel || novel.meta.wordCount !== 1234 || novel.meta.status !== 'ongoing') {
        throw new Error('元数据更新后不一致')
      }
      results.push({ name: 'updateNovelMeta', ok: true })
    } catch (e) {
      results.push({ name: 'updateNovelMeta', ok: false, error: String(e) })
    }

    // 7. listOSSNovels
    try {
      const novels = await listOSSNovels()
      const found = novels.some(n => n.id === TEST_NOVEL_ID)
      if (!found) {
        throw new Error('listOSSNovels 未找到测试小说')
      }
      results.push({ name: 'listOSSNovels', ok: true })
    } catch (e) {
      results.push({ name: 'listOSSNovels', ok: false, error: String(e) })
    }

    // 8. removeChapterFromIndex（删除索引中的章节，不删内容文件）
    try {
      const chapterIdToRemove = 'oss-api-ch-remove-' + Date.now()
      await updateChapterInIndex(TEST_NOVEL_ID, chapterIdToRemove, {
        title: '待删除章',
        wordCount: 0,
        order: 99
      })
      await removeChapterFromIndex(TEST_NOVEL_ID, chapterIdToRemove)
      const meta = await getNovelMetaFromOSS(TEST_NOVEL_ID)
      const stillHas = meta?.chapters.some(c => c.id === chapterIdToRemove)
      if (stillHas) {
        throw new Error('removeChapterFromIndex 未正确移除')
      }
      results.push({ name: 'removeChapterFromIndex', ok: true })
    } catch (e) {
      results.push({ name: 'removeChapterFromIndex', ok: false, error: String(e) })
    }

    // 9. 清理
    try {
      await deleteNovelFromOSS(TEST_NOVEL_ID)
      const novel = await getNovelFromOSS(TEST_NOVEL_ID)
      if (novel) {
        throw new Error('deleteNovelFromOSS 后数据仍存在')
      }
      results.push({ name: 'deleteNovelFromOSS', ok: true })
    } catch (e) {
      results.push({ name: 'deleteNovelFromOSS', ok: false, error: String(e) })
    }

    const passed = results.filter(r => r.ok).length
    const failed = results.filter(r => !r.ok).length

    return NextResponse.json({
      success: failed === 0,
      passed,
      failed,
      results,
      testNovelId: TEST_NOVEL_ID
    })
  } catch (error) {
    console.error('OSS test error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '测试异常',
      results
    }, { status: 500 })
  }
}
