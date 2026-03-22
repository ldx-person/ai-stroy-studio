/**
 * OSS 真相源 ↔ API/前端 DTO 转换与字数汇总
 * @see docs/OSS_SOURCE_OF_TRUTH.md
 */

import {
  listOSSNovels,
  getNovelMetaFromOSS,
  getNovelFromOSS,
  getChapterContent,
  updateNovelMeta,
  reconcileChapterWordCountsWithFiles,
  type OSSNovelFull,
  type OSSNovelMeta,
  isOSSAvailable,
} from '@/lib/oss'
import { countWordsFromText, sumWordCountsFromBodies, sumWordCountsFromChapterIndex } from '@/lib/word-count'
import { normalizeChapterIndexEntries } from '@/lib/chapter-meta'
import type { OSSChapterMeta } from '@/lib/oss'

/** 与 page.tsx / use-novels 对齐的客户端小说形状 */
export interface ClientNovel {
  id: string
  title: string
  description: string | null
  cover: string | null
  genre: string | null
  status: string
  wordCount: number
  chapters: ClientChapter[]
  createdAt: string
  updatedAt: string
}

export interface ClientChapter {
  id: string
  novelId: string
  /** 第几章（≥1），与标题正文分离 */
  chapterNumber: number
  title: string
  content: string
  wordCount: number
  order: number
  isPublished: boolean
  createdAt: string
  updatedAt: string
}

export function novelFullToClient(full: OSSNovelFull): ClientNovel {
  const m = full.meta
  const metasOnly: OSSChapterMeta[] = full.chapters.map(({ content: _c, ...rest }) => rest)
  const normalized = normalizeChapterIndexEntries(metasOnly)
  const contentById = new Map(full.chapters.map((ch) => [ch.id, ch.content ?? '']))
  const chapters = normalized.map((ch) => {
    const content = contentById.get(ch.id) ?? ''
    const bodyLen = countWordsFromText(content)
    const wordCount =
      bodyLen > 0
        ? bodyLen
        : typeof ch.wordCount === 'number' && Number.isFinite(ch.wordCount)
          ? ch.wordCount
          : 0
    return {
      id: ch.id,
      novelId: m.id,
      chapterNumber: ch.chapterNumber!,
      title: ch.title,
      content,
      wordCount,
      order: ch.order,
      isPublished: ch.isPublished,
      createdAt: ch.createdAt,
      updatedAt: ch.updatedAt,
    }
  })
  return {
    id: m.id,
    title: m.title,
    description: full.description,
    cover: null,
    genre: m.genre,
    status: m.status,
    // 有正文则以正文为准；仅索引模式（正文全空）用 chapters.json 累计，与列表一致
    wordCount:
      full.chapters.some((c) => (c.content?.length ?? 0) > 0)
        ? sumWordCountsFromBodies(full.chapters)
        : sumWordCountsFromChapterIndex(chapters),
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    chapters,
  }
}

/** 列表用：元数据 + 章节目录（正文留空，按需再 GET chapter） */
export async function buildClientNovelListItem(
  meta: OSSNovelMeta
): Promise<ClientNovel> {
  const detail = isOSSAvailable() ? await getNovelMetaFromOSS(meta.id) : null
  const raw = detail?.chapters ?? []
  const chaptersNorm = normalizeChapterIndexEntries(raw as OSSChapterMeta[])
  return {
    id: meta.id,
    title: meta.title,
    description: detail?.description ?? null,
    cover: null,
    genre: meta.genre,
    status: meta.status,
    wordCount: sumWordCountsFromChapterIndex(chaptersNorm),
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    chapters: chaptersNorm.map((ch) => ({
      id: ch.id,
      novelId: meta.id,
      chapterNumber: ch.chapterNumber!,
      title: ch.title,
      content: '',
      wordCount: ch.wordCount,
      order: ch.order,
      isPublished: ch.isPublished,
      createdAt: ch.createdAt,
      updatedAt: ch.updatedAt,
    })),
  }
}

export async function listClientNovelsFromOss(): Promise<ClientNovel[]> {
  if (!isOSSAvailable()) return []
  const metas = await listOSSNovels()
  return Promise.all(metas.map((m) => buildClientNovelListItem(m)))
}

/** 根据 OSS 章节索引汇总字数并写回 novel.json（与列表/详情展示用的聚合规则一致） */
export async function recomputeNovelWordCountFromOss(novelId: string): Promise<number> {
  const meta = await getNovelMetaFromOSS(novelId)
  if (!meta) return 0
  const total = sumWordCountsFromChapterIndex(meta.chapters)
  await updateNovelMeta(novelId, { wordCount: total })
  return total
}

/** 按 .txt 正文校准 chapters.json 与 novel.json（修复历史脏数据） */
export async function reconcileNovelWordStatsFromOss(novelId: string) {
  return reconcileChapterWordCountsWithFiles(novelId)
}

export async function loadNovelFullAsClient(
  novelId: string,
  options?: { loadBodies?: boolean }
): Promise<ClientNovel | null> {
  const full = await getNovelFromOSS(novelId, options)
  if (!full) return null
  return novelFullToClient(full)
}

export async function getChapterBody(novelId: string, chapterId: string): Promise<string> {
  return getChapterContent(novelId, chapterId)
}
