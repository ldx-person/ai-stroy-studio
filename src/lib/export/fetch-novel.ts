import { getNovelFromOSS, isOSSAvailable } from '@/lib/oss'
import type { NovelExportData } from './types'

export async function fetchNovelForExport(novelId: string): Promise<NovelExportData> {
  if (!isOSSAvailable()) {
    throw new Error('OSS 未配置，无法导出')
  }
  const full = await getNovelFromOSS(novelId)
  if (!full) throw new Error('小说不存在')

  return {
    id: full.meta.id,
    title: full.meta.title,
    description: full.description,
    cover: null,
    genre: full.meta.genre,
    status: full.meta.status,
    chapters: full.chapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      content: ch.content,
      order: ch.order,
    })),
  }
}
