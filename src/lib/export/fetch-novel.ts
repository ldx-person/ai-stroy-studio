import { db } from '@/lib/db'
import { isOSSAvailable, getChapterContent } from '@/lib/oss'
import type { NovelExportData } from './types'

export async function fetchNovelForExport(novelId: string): Promise<NovelExportData> {
  const novel = await db.novel.findUnique({
    where: { id: novelId },
    include: {
      chapters: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          content: true,
          order: true,
        }
      }
    }
  })

  if (!novel) throw new Error('小说不存在')

  // 对空内容章节尝试 OSS 回退
  let chapters = novel.chapters
  if (isOSSAvailable()) {
    chapters = await Promise.all(
      chapters.map(async (chapter) => {
        if (!chapter.content) {
          try {
            const content = await getChapterContent(novelId, chapter.id)
            if (content) return { ...chapter, content }
          } catch (e) {
            console.error(`[Export] 读取章节 ${chapter.id} OSS 内容失败:`, e)
          }
        }
        return chapter
      })
    )
  }

  return {
    id: novel.id,
    title: novel.title,
    description: novel.description,
    cover: novel.cover,
    genre: novel.genre,
    status: novel.status,
    chapters: chapters.map(ch => ({
      id: ch.id,
      title: ch.title,
      content: ch.content,
      order: ch.order,
    }))
  }
}
