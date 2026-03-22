import OSS from 'ali-oss'
import { countWordsFromText, sumWordCountsFromChapterIndex } from '@/lib/word-count'
import { normalizeChapterIndexEntries, stripLegacyChapterPrefixFromTitle } from '@/lib/chapter-meta'

/**
 * OSS数据结构设计
 * 
 * novels/{novelId}/
 * ├── novel.json           # 小说元数据（全书字数为 Σ 章节索引的缓存，以 chapters + .txt 为准）
 * ├── description.txt      # 简介
 * ├── outline.json         # 大纲
 * ├── characters.json      # 角色列表
 * ├── chapters.json        # 章节索引（id, title, order, wordCount等）
 * └── chapters/
 *     └── {chapterId}.txt  # 章节内容
 */

// 动态获取 OSS 配置（每次调用时读取，避免模块初始化时环境变量未注入）
function getOSSConfig() {
  return {
    region: process.env.OSS_REGION || 'oss-cn-beijing',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
    bucket: process.env.OSS_BUCKET || 'ai-story-stroe',
  }
}

// 检查配置是否完整
function checkOSSConfig(): boolean {
  const cfg = getOSSConfig()
  return !!(cfg.accessKeyId && cfg.accessKeySecret && cfg.bucket)
}

// 创建OSS客户端（每次调用时动态创建，确保使用最新环境变量）
function getOSSClient(): OSS {
  if (!checkOSSConfig()) {
    throw new Error('OSS配置不完整，请检查环境变量')
  }
  return new OSS(getOSSConfig())
}

// OSS路径前缀
const NOVEL_PREFIX = 'novels'

// ==================== 小说元数据类型 ====================

export interface OSSNovelMeta {
  id: string
  title: string
  genre: string | null
  status: string
  wordCount: number
  createdAt: string
  updatedAt: string
}

export interface OSSChapterMeta {
  id: string
  title: string
  /** 第几章（≥1），与 title 分离；缺失时由读路径/迁移按标题或顺序补全 */
  chapterNumber?: number
  wordCount: number
  order: number
  isPublished: boolean
  createdAt: string
  updatedAt: string
}

export interface OSSCharacterMeta {
  id: string
  name: string
  description: string | null
  avatar: string | null
  createdAt: string
  updatedAt: string
}

export interface OSSNovelFull {
  meta: OSSNovelMeta
  description: string | null
  outline: unknown | null
  characters: OSSCharacterMeta[]
  storyBible?: unknown | null
  chapters: Array<OSSChapterMeta & { content: string }>
}

// ==================== 作品档案（Story Bible） ====================

const STORY_BIBLE_FILENAME = 'story_bible.json'

export async function saveStoryBibleToOSS(novelId: string, storyBible: unknown): Promise<void> {
  const client = getOSSClient()
  await client.put(
    `${NOVEL_PREFIX}/${novelId}/${STORY_BIBLE_FILENAME}`,
    Buffer.from(JSON.stringify(storyBible ?? {}, null, 2), 'utf-8')
  )
}

export async function getStoryBibleFromOSS(novelId: string): Promise<unknown | null> {
  const client = getOSSClient()
  try {
    const result = await client.get(`${NOVEL_PREFIX}/${novelId}/${STORY_BIBLE_FILENAME}`)
    return JSON.parse(result.content.toString('utf-8'))
  } catch {
    return null
  }
}

// ==================== 小说完整数据操作 ====================

/**
 * 保存小说完整数据到OSS
 */
export async function saveNovelToOSS(
  novelId: string,
  data: {
    title: string
    genre?: string | null
    status?: string
    wordCount?: number
    description?: string | null
    outline?: unknown | null
    characters?: OSSCharacterMeta[]
    chapters?: Array<OSSChapterMeta & { content?: string }>
  }
): Promise<void> {
  const client = getOSSClient()
  const now = new Date().toISOString()

  // 先算章节索引（若有章节，全书字数必须以章节为准，忽略传入的孤立 wordCount）
  let chaptersIndex: OSSChapterMeta[] = []
  if (data.chapters && data.chapters.length > 0) {
    chaptersIndex = data.chapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      chapterNumber: ch.chapterNumber,
      // 有正文则以正文为准，避免索引与 .txt 不一致
      wordCount:
        typeof ch.content === 'string'
          ? countWordsFromText(ch.content)
          : typeof ch.wordCount === 'number'
            ? ch.wordCount
            : 0,
      order: ch.order,
      isPublished: ch.isPublished,
      createdAt: ch.createdAt || now,
      updatedAt: now,
    }))
  }

  const derivedWordCount =
    chaptersIndex.length > 0
      ? chaptersIndex.reduce((s, ch) => s + (ch.wordCount || 0), 0)
      : data.wordCount || 0

  // 1. 保存小说元数据
  const novelMeta: OSSNovelMeta = {
    id: novelId,
    title: data.title,
    genre: data.genre || null,
    status: data.status || 'draft',
    wordCount: derivedWordCount,
    createdAt: now,
    updatedAt: now,
  }

  await client.put(
    `${NOVEL_PREFIX}/${novelId}/novel.json`,
    Buffer.from(JSON.stringify(novelMeta, null, 2), 'utf-8')
  )
  
  // 2. 保存简介
  if (data.description) {
    await client.put(
      `${NOVEL_PREFIX}/${novelId}/description.txt`,
      Buffer.from(data.description, 'utf-8')
    )
  }
  
  // 3. 保存大纲
  if (data.outline) {
    await client.put(
      `${NOVEL_PREFIX}/${novelId}/outline.json`,
      Buffer.from(JSON.stringify(data.outline, null, 2), 'utf-8')
    )
  }
  
  // 4. 保存角色列表
  if (data.characters && data.characters.length > 0) {
    await client.put(
      `${NOVEL_PREFIX}/${novelId}/characters.json`,
      Buffer.from(JSON.stringify(data.characters, null, 2), 'utf-8')
    )
  }
  
  // 5. 保存章节索引和内容
  if (data.chapters && data.chapters.length > 0) {
    await client.put(
      `${NOVEL_PREFIX}/${novelId}/chapters.json`,
      Buffer.from(JSON.stringify(chaptersIndex, null, 2), 'utf-8')
    )
    
    // 保存每个章节的内容
    for (const chapter of data.chapters) {
      if (chapter.content) {
        await client.put(
          `${NOVEL_PREFIX}/${novelId}/chapters/${chapter.id}.txt`,
          Buffer.from(chapter.content, 'utf-8')
        )
      }
    }
  }
}

/**
 * 兼容 chapters.json 既可能是数组，也可能是 { chapters: [...] } 等历史形态
 */
function chaptersJsonParsedToRawArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>
    if (Array.isArray(o.chapters)) return o.chapters
    if (Array.isArray(o.data)) return o.data
  }
  return []
}

/**
 * 将单条索引归一化为 OSSChapterMeta：统一 id 字段（id / chapterId / uuid），补默认字段
 */
function coerceOssChapterMetaRow(raw: unknown): OSSChapterMeta | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const idRaw = o.id ?? o.chapterId ?? o.uuid ?? o.chapter_id
  let id = ''
  if (typeof idRaw === 'string' && idRaw.trim()) id = idRaw.trim()
  else if (typeof idRaw === 'number' && Number.isFinite(idRaw)) id = String(Math.trunc(idRaw))
  if (!id) return null

  const now = new Date().toISOString()
  const title = typeof o.title === 'string' ? o.title : ''
  const wordCount =
    typeof o.wordCount === 'number' && Number.isFinite(o.wordCount) ? o.wordCount : 0
  const order = typeof o.order === 'number' && Number.isFinite(o.order) ? o.order : 0
  const chapterNumber =
    typeof o.chapterNumber === 'number' &&
    Number.isFinite(o.chapterNumber) &&
    o.chapterNumber >= 1
      ? Math.floor(o.chapterNumber)
      : undefined

  return {
    id,
    title,
    chapterNumber,
    wordCount,
    order,
    isPublished: Boolean(o.isPublished),
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now,
  }
}

/** 解析 OSS chapters.json 缓冲区为章节索引（列表与全文读取共用） */
function parseChaptersIndexFromOssBody(body: Buffer | string): OSSChapterMeta[] {
  const text = (typeof body === 'string' ? body : body.toString('utf-8')).replace(/^\uFEFF/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const rawList = chaptersJsonParsedToRawArray(parsed)
  const out: OSSChapterMeta[] = []
  for (const raw of rawList) {
    const row = coerceOssChapterMetaRow(raw)
    if (row) out.push(row)
  }
  return out
}

/**
 * 从OSS获取小说元数据（不读取章节内容，只读取章节索引）
 */
export async function getNovelMetaFromOSS(novelId: string): Promise<{
  description: string | null
  chapters: OSSChapterMeta[]
} | null> {
  const client = getOSSClient()
  const prefix = `${NOVEL_PREFIX}/${novelId}/`
  
  try {
    // 读取简介
    let description: string | null = null
    try {
      const descResult = await client.get(`${prefix}description.txt`)
      description = descResult.content.toString('utf-8')
    } catch {
      // 简介可能不存在
    }
    
    // 读取章节索引（不读取内容）
    let chapters: OSSChapterMeta[] = []
    try {
      const chaptersIndexResult = await client.get(`${prefix}chapters.json`)
      chapters = parseChaptersIndexFromOssBody(chaptersIndexResult.content)
      chapters.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    } catch {
      // 章节索引可能不存在
    }
    
    return { description, chapters }
  } catch (error) {
    console.error('从OSS获取小说元数据失败:', error)
    return null
  }
}

export type GetNovelFromOSSOptions = {
  /**
   * 是否读取每章 .txt 正文。false 时仅读 chapters.json，正文置空（用于 API 详情/避免数百章巨型 JSON 截断或解析失败）
   * @default true
   */
  loadBodies?: boolean
}

/**
 * 从OSS获取单个小说完整数据
 */
export async function getNovelFromOSS(
  novelId: string,
  options?: GetNovelFromOSSOptions
): Promise<OSSNovelFull | null> {
  const loadBodies = options?.loadBodies !== false
  const client = getOSSClient()
  const prefix = `${NOVEL_PREFIX}/${novelId}/`
  
  try {
    // 读取小说元数据
    let novelMeta: OSSNovelMeta | null = null
    try {
      const metaResult = await client.get(`${prefix}novel.json`)
      novelMeta = JSON.parse(metaResult.content.toString('utf-8'))
    } catch {
      // 元数据不存在，尝试从旧结构迁移
      return await migrateOldStructure(novelId)
    }
    
    if (!novelMeta) return null
    
    // 读取简介
    let description: string | null = null
    try {
      const descResult = await client.get(`${prefix}description.txt`)
      description = descResult.content.toString('utf-8')
    } catch {
      // 简介可能不存在
    }
    
    // 读取大纲
    let outline: unknown | null = null
    try {
      const outlineResult = await client.get(`${prefix}outline.json`)
      outline = JSON.parse(outlineResult.content.toString('utf-8'))
    } catch {
      // 大纲可能不存在
    }
    
    // 读取角色
    let characters: OSSCharacterMeta[] = []
    try {
      const charResult = await client.get(`${prefix}characters.json`)
      characters = JSON.parse(charResult.content.toString('utf-8'))
    } catch {
      // 角色可能不存在
    }
    
    // 读取章节索引
    let chapters: Array<OSSChapterMeta & { content: string }> = []
    try {
      const chaptersIndexResult = await client.get(`${prefix}chapters.json`)
      const chaptersIndex = parseChaptersIndexFromOssBody(chaptersIndexResult.content)

      if (!loadBodies) {
        for (const ch of chaptersIndex) {
          chapters.push({ ...ch, content: '' })
        }
      } else {
        // 读取每个章节的内容（索引已在 parse 阶段统一 id）
        for (const ch of chaptersIndex) {
          try {
            const contentResult = await client.get(`${prefix}chapters/${ch.id}.txt`)
            chapters.push({
              ...ch,
              content: contentResult.content.toString('utf-8')
            })
          } catch {
            chapters.push({
              ...ch,
              content: ''
            })
          }
        }
      }
      
      // 按顺序排序
      chapters.sort((a, b) => a.order - b.order)
    } catch {
      // 章节可能不存在
    }
    
    return {
      meta: novelMeta,
      description,
      outline,
      characters,
      chapters
    }
  } catch (error) {
    console.error('从OSS获取小说失败:', error)
    return null
  }
}

/**
 * 列出OSS中所有小说
 * 优化：使用 delimiter 按目录分组，直接定位 novel.json，并发读取减少请求数
 */
export async function listOSSNovels(): Promise<OSSNovelMeta[]> {
  const client = getOSSClient()
  
  try {
    const novels: OSSNovelMeta[] = []
    let marker: string | undefined
    
    // 第二步：并发读取所有 novel.json 文件（最多 10 个并发）
    const CONCURRENCY = 10
    
    do {
      // 注意：不传 undefined 的 marker，避免 ali-oss 将其序列化为字符串导致 OSS 返回异常结果
      const listParams: Record<string, unknown> = {
        prefix: `${NOVEL_PREFIX}/`,
        delimiter: '/',
        'max-keys': 1000,
      }
      if (marker) listParams.marker = marker
      const result = await client.list(listParams as Parameters<typeof client.list>[0])
      
      const prefixes: string[] = result.prefixes || []
    
      for (let i = 0; i < prefixes.length; i += CONCURRENCY) {
        const batch = prefixes.slice(i, i + CONCURRENCY)
        const batchResults = await Promise.allSettled(
          batch.map(async (prefix) => {
            const novelJsonKey = `${prefix}novel.json`
            const metaResult = await client.get(novelJsonKey)
            const meta: OSSNovelMeta = JSON.parse(metaResult.content.toString('utf-8'))
            return meta
          })
        )
        for (const res of batchResults) {
          if (res.status === 'fulfilled') {
            novels.push(res.value)
          } else {
            console.error('读取小说元数据失败:', res.reason)
          }
        }
      }
    
      marker = result.nextMarker
    } while (marker)
    
    // 按更新时间排序
    novels.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    
    return novels
  } catch (error) {
    console.error('列出OSS小说失败:', error)
    return []
  }
}

/**
 * 分页列出 OSS 目录下所有对象（解决默认 max-keys=100 导致遗漏）
 */
async function listAllObjects(
  client: InstanceType<typeof import('ali-oss')>,
  prefix: string
): Promise<Array<{ name: string }>> {
  const all: Array<{ name: string }> = []
  let marker: string | undefined
  do {
    const result = await client.list({
      prefix,
      'max-keys': 1000,
      marker
    })
    if (result.objects) all.push(...result.objects)
    marker = result.nextMarker
  } while (marker)
  return all
}

/**
 * 迁移旧数据结构
 */
async function migrateOldStructure(novelId: string): Promise<OSSNovelFull | null> {
  const client = getOSSClient()
  const prefix = `${NOVEL_PREFIX}/${novelId}/`
  
  try {
    const objects = await listAllObjects(client, prefix)
    if (objects.length === 0) return null
    
    const now = new Date().toISOString()
    const chapters: Array<OSSChapterMeta & { content: string }> = []
    let description: string | null = null
    
    for (const ossObj of objects) {
      const ossKey = ossObj.name
      const fileName = ossKey.replace(prefix, '')
      
      if (fileName === 'description.txt') {
        try {
          const content = await client.get(ossKey)
          description = content.content.toString('utf-8')
        } catch (e) {
          console.error('读取简介失败:', e)
        }
      } else if (fileName.startsWith('chapters/') && fileName.endsWith('.txt')) {
        try {
          const content = await client.get(ossKey)
          const chapterId = fileName.replace('chapters/', '').replace('.txt', '')
          const ord = chapters.length
          chapters.push({
            id: chapterId,
            title: '（无标题）',
            chapterNumber: ord + 1,
            wordCount: countWordsFromText(content.content.toString('utf-8')),
            order: ord,
            isPublished: false,
            createdAt: now,
            updatedAt: now,
            content: content.content.toString('utf-8')
          })
        } catch (e) {
          console.error('读取章节失败:', e)
        }
      }
    }
    
    if (chapters.length === 0 && !description) {
      return null
    }
    
    // 创建元数据
    const meta: OSSNovelMeta = {
      id: novelId,
      title: `小说_${novelId.slice(0, 6)}`,
      genre: null,
      status: 'draft',
      wordCount: chapters.reduce((sum, ch) => sum + ch.wordCount, 0),
      createdAt: now,
      updatedAt: now
    }
    
    // 保存新结构
    await saveNovelToOSS(novelId, {
      title: meta.title,
      status: meta.status,
      wordCount: meta.wordCount,
      description: description || undefined,
      chapters: chapters
    })
    
    return {
      meta,
      description,
      outline: null,
      characters: [],
      chapters
    }
  } catch (error) {
    console.error('迁移旧结构失败:', error)
    return null
  }
}

// ==================== 单个操作 ====================

/**
 * 更新小说元数据
 */
export async function updateNovelMeta(
  novelId: string,
  updates: Partial<Omit<OSSNovelMeta, 'id' | 'createdAt'>>
): Promise<void> {
  const client = getOSSClient()
  
  // 读取现有元数据
  let existingMeta: OSSNovelMeta
  try {
    const result = await client.get(`${NOVEL_PREFIX}/${novelId}/novel.json`)
    existingMeta = JSON.parse(result.content.toString('utf-8'))
  } catch {
    // 不存在则创建新的
    existingMeta = {
      id: novelId,
      title: updates.title || '新小说',
      genre: null,
      status: 'draft',
      wordCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }
  
  // 合并更新
  const newMeta: OSSNovelMeta = {
    ...existingMeta,
    ...updates,
    updatedAt: new Date().toISOString()
  }
  
  await client.put(
    `${NOVEL_PREFIX}/${novelId}/novel.json`,
    Buffer.from(JSON.stringify(newMeta, null, 2), 'utf-8')
  )
}

/**
 * 保存章节内容
 */
export async function saveChapterContent(
  novelId: string,
  chapterId: string,
  content: string
): Promise<void> {
  const client = getOSSClient()
  
  // 保存章节内容
  await client.put(
    `${NOVEL_PREFIX}/${novelId}/chapters/${chapterId}.txt`,
    Buffer.from(content, 'utf-8')
  )
  
  // 更新章节索引（与 .txt 解码后字符串长度一致）
  await updateChapterInIndex(novelId, chapterId, { wordCount: countWordsFromText(content) })
}

/**
 * 按各章 chapters/{id}.txt 实际长度重写 chapters.json 的 wordCount，并写回 novel.json 总字数。
 * 用于修复导入/外部修改/历史脏数据导致的「索引 ≠ 正文」。
 */
export async function reconcileChapterWordCountsWithFiles(novelId: string): Promise<{
  chaptersChecked: number
  entriesUpdated: number
  totalWordCount: number
}> {
  const client = getOSSClient()
  const prefix = `${NOVEL_PREFIX}/${novelId}/`

  let chapters: OSSChapterMeta[] = []
  try {
    const result = await client.get(`${prefix}chapters.json`)
    chapters = parseChaptersIndexFromOssBody(result.content)
  } catch {
    return { chaptersChecked: 0, entriesUpdated: 0, totalWordCount: 0 }
  }

  let entriesUpdated = 0
  const next: OSSChapterMeta[] = await Promise.all(
    chapters.map(async (ch) => {
      if (!ch?.id) return ch
      let len = 0
      try {
        const r = await client.get(`${prefix}chapters/${ch.id}.txt`)
        len = countWordsFromText(r.content.toString('utf-8'))
      } catch {
        len = 0
      }
      const prev = typeof ch.wordCount === 'number' ? ch.wordCount : 0
      if (len !== prev) entriesUpdated++
      return { ...ch, wordCount: len }
    })
  )

  next.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  await client.put(`${prefix}chapters.json`, Buffer.from(JSON.stringify(next, null, 2), 'utf-8'))

  const totalWordCount = next.reduce((s, ch) => s + (typeof ch.wordCount === 'number' ? ch.wordCount : 0), 0)
  await updateNovelMeta(novelId, { wordCount: totalWordCount })

  return { chaptersChecked: next.length, entriesUpdated, totalWordCount }
}

/**
 * 获取章节内容
 */
export async function getChapterContent(
  novelId: string,
  chapterId: string
): Promise<string> {
  const client = getOSSClient()
  
  try {
    const result = await client.get(`${NOVEL_PREFIX}/${novelId}/chapters/${chapterId}.txt`)
    return result.content.toString('utf-8')
  } catch {
    return ''
  }
}

/**
 * 添加或更新章节索引
 */
export async function updateChapterInIndex(
  novelId: string,
  chapterId: string,
  updates: Partial<OSSChapterMeta>
): Promise<void> {
  const client = getOSSClient()
  const indexPath = `${NOVEL_PREFIX}/${novelId}/chapters.json`
  const now = new Date().toISOString()
  
  // 读取现有索引
  let chapters: OSSChapterMeta[] = []
  try {
    const result = await client.get(indexPath)
    chapters = parseChaptersIndexFromOssBody(result.content)
  } catch {
    // 索引不存在
  }
  
  // 查找或添加章节
  const existingIndex = chapters.findIndex(ch => ch.id === chapterId)
  if (existingIndex >= 0) {
    chapters[existingIndex] = {
      ...chapters[existingIndex],
      ...updates,
      updatedAt: now
    }
  } else {
    chapters.push({
      id: chapterId,
      title: updates.title || '新章节',
      chapterNumber: updates.chapterNumber,
      wordCount: updates.wordCount || 0,
      order: updates.order ?? chapters.length,
      isPublished: updates.isPublished ?? false,
      createdAt: now,
      updatedAt: now
    })
  }
  
  // 按顺序排序
  chapters.sort((a, b) => a.order - b.order)
  
  // 保存索引
  await client.put(indexPath, Buffer.from(JSON.stringify(chapters, null, 2), 'utf-8'))
}

/** 整体替换 chapters.json（内部工具 / 归一化迁移） */
export async function replaceChaptersJson(novelId: string, chapters: OSSChapterMeta[]): Promise<void> {
  const client = getOSSClient()
  const indexPath = `${NOVEL_PREFIX}/${novelId}/chapters.json`
  await client.put(indexPath, Buffer.from(JSON.stringify(chapters, null, 2), 'utf-8'))
}

export type RepairChapterSequenceResult = {
  ok: boolean
  error?: string
  updatedCount: number
}

/**
 * 按当前阅读顺序（order 升序）将 chapterNumber 重排为 1..n，order 重排为 0..n-1，
 * 并剥离标题中的「第N章」等遗留前缀（.txt 不动，仅改 chapters.json）
 */
export async function repairChapterSequenceToMatchReadingOrder(
  novelId: string
): Promise<RepairChapterSequenceResult> {
  const meta = await getNovelMetaFromOSS(novelId)
  if (!meta?.chapters.length) {
    return { ok: false, error: '无章节索引或无法读取 OSS', updatedCount: 0 }
  }

  const chapters = [...meta.chapters]
  const orderCount = new Map<number, number>()
  for (const ch of chapters) {
    const o = ch.order ?? 0
    orderCount.set(o, (orderCount.get(o) ?? 0) + 1)
  }
  for (const [, n] of orderCount) {
    if (n > 1) {
      return {
        ok: false,
        error: '存在相同 order 的多章，请先使用「删除重复」处理后再修复章号',
        updatedCount: 0,
      }
    }
  }

  chapters.sort((a, b) => {
    if ((a.order ?? 0) !== (b.order ?? 0)) return (a.order ?? 0) - (b.order ?? 0)
    return a.id.localeCompare(b.id)
  })

  const now = new Date().toISOString()
  const next: OSSChapterMeta[] = chapters.map((ch, i) => ({
    ...ch,
    order: i,
    chapterNumber: i + 1,
    title: stripLegacyChapterPrefixFromTitle(ch.title),
    updatedAt: now,
  }))

  await replaceChaptersJson(novelId, next)

  const total = sumWordCountsFromChapterIndex(next)
  await updateNovelMeta(novelId, { wordCount: total })

  return { ok: true, updatedCount: next.length }
}

/**
 * 归一化章节序号与标题并写回 OSS（chapterNumber、剥离标题前缀、order 连续化）
 */
export async function normalizeAndPersistChapterMeta(novelId: string): Promise<{
  count: number
  changed: boolean
}> {
  const meta = await getNovelMetaFromOSS(novelId)
  if (!meta?.chapters.length) return { count: 0, changed: false }
  const before = JSON.stringify(meta.chapters)
  const next = normalizeChapterIndexEntries(meta.chapters)
  const after = JSON.stringify(next)
  const changed = before !== after
  if (changed) await replaceChaptersJson(novelId, next)
  return { count: next.length, changed }
}

/**
 * 从索引中删除章节
 */
export async function removeChapterFromIndex(
  novelId: string,
  chapterId: string
): Promise<void> {
  const client = getOSSClient()
  const indexPath = `${NOVEL_PREFIX}/${novelId}/chapters.json`
  
  // 读取现有索引
  let chapters: OSSChapterMeta[] = []
  try {
    const result = await client.get(indexPath)
    chapters = parseChaptersIndexFromOssBody(result.content)
  } catch {
    return
  }
  
  // 过滤掉要删除的章节
  chapters = chapters.filter(ch => ch.id !== chapterId)
  
  // 重新排序
  chapters.sort((a, b) => a.order - b.order)
  chapters = chapters.map((ch, i) => ({ ...ch, order: i }))
  
  // 保存索引
  await client.put(indexPath, Buffer.from(JSON.stringify(chapters, null, 2), 'utf-8'))
  
  // 删除章节内容文件
  try {
    await client.delete(`${NOVEL_PREFIX}/${novelId}/chapters/${chapterId}.txt`)
  } catch {
    // 文件可能不存在
  }
}

/** chapters.json 索引条数 vs novels/{id}/chapters/*.txt 文件数 对照报告 */
export type ChapterIndexVsTxtReport = {
  novelId: string
  title: string
  /** chapters.json 解析后的条目数（含重复 id 时重复计数） */
  indexEntryCount: number
  /** 索引中去重后的 id 数 */
  uniqueIndexIdCount: number
  /** OSS 上 chapters/ 下 .txt 对象数 */
  txtFileCount: number
  /** 索引中出现多次的不同 id */
  duplicateIndexIds: string[]
  /** 索引有 id、但无对应 {id}.txt */
  missingTxtForIndexId: string[]
  /** 有 .txt 但索引中无此 id */
  orphanTxtIds: string[]
  /** indexEntryCount === txtFileCount（仅数量相等，不保证无重复/孤儿） */
  rawCountMatch: boolean
  /**
   * 强一致：无重复 id、无缺失 txt、无孤儿 txt，且 indexEntryCount === txtFileCount
   */
  fullyConsistent: boolean
  error?: string
}

/**
 * 校验单本小说：章节索引（chapters.json）与正文文件（chapters/*.txt）是否一致
 */
export async function verifyNovelChapterIndexVsTxtFiles(
  novelId: string
): Promise<ChapterIndexVsTxtReport> {
  const client = getOSSClient()
  const prefix = `${NOVEL_PREFIX}/${novelId}/`
  let title = novelId
  try {
    const metaResult = await client.get(`${prefix}novel.json`)
    const meta = JSON.parse(metaResult.content.toString('utf-8')) as { title?: string }
    if (meta?.title) title = meta.title
  } catch {
    /* novel.json 可能不存在 */
  }

  let indexRows: OSSChapterMeta[] = []
  try {
    const buf = await client.get(`${prefix}chapters.json`)
    indexRows = parseChaptersIndexFromOssBody(buf.content)
  } catch (e) {
    return {
      novelId,
      title,
      indexEntryCount: 0,
      uniqueIndexIdCount: 0,
      txtFileCount: 0,
      duplicateIndexIds: [],
      missingTxtForIndexId: [],
      orphanTxtIds: [],
      rawCountMatch: false,
      fullyConsistent: false,
      error: `无法读取 chapters.json: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  const indexIds = indexRows.map((r) => r.id)
  const idCounts = new Map<string, number>()
  for (const id of indexIds) {
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
  }
  const duplicateIndexIds = [...idCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id)
  const uniqueIndexIdSet = new Set(indexIds)

  const chapterPrefix = `${prefix}chapters/`
  let objects: Array<{ name: string }> = []
  try {
    objects = await listAllObjects(client, chapterPrefix)
  } catch (e) {
    return {
      novelId,
      title,
      indexEntryCount: indexIds.length,
      uniqueIndexIdCount: uniqueIndexIdSet.size,
      txtFileCount: 0,
      duplicateIndexIds,
      missingTxtForIndexId: [...uniqueIndexIdSet],
      orphanTxtIds: [],
      rawCountMatch: false,
      fullyConsistent: false,
      error: `列出 chapters/ 失败: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  const txtIds: string[] = []
  for (const o of objects) {
    if (!o.name.endsWith('.txt')) continue
    const rel = o.name.slice(chapterPrefix.length)
    if (!rel) continue
    const id = rel.replace(/\.txt$/i, '')
    if (id) txtIds.push(id)
  }
  const txtSet = new Set(txtIds)

  const missingTxtForIndexId = [...uniqueIndexIdSet].filter((id) => !txtSet.has(id))
  const orphanTxtIds = txtIds.filter((id) => !uniqueIndexIdSet.has(id))

  const rawCountMatch = indexIds.length === txtIds.length
  const fullyConsistent =
    duplicateIndexIds.length === 0 &&
    missingTxtForIndexId.length === 0 &&
    orphanTxtIds.length === 0 &&
    rawCountMatch

  return {
    novelId,
    title,
    indexEntryCount: indexIds.length,
    uniqueIndexIdCount: uniqueIndexIdSet.size,
    txtFileCount: txtIds.length,
    duplicateIndexIds,
    missingTxtForIndexId,
    orphanTxtIds,
    rawCountMatch,
    fullyConsistent,
  }
}

export type VerifyAllChapterFilesSummary = {
  novelCount: number
  fullyConsistentCount: number
  mismatchCount: number
}

/**
 * 校验 OSS 中所有小说：章节索引条数与 .txt 文件数是否一致（逐本报告）
 */
export async function verifyAllNovelsChapterIndexVsTxtFiles(): Promise<{
  summary: VerifyAllChapterFilesSummary
  reports: ChapterIndexVsTxtReport[]
}> {
  const metas = await listOSSNovels()
  const reports: ChapterIndexVsTxtReport[] = []
  for (const m of metas) {
    reports.push(await verifyNovelChapterIndexVsTxtFiles(m.id))
  }
  const fullyConsistentCount = reports.filter((r) => r.fullyConsistent).length
  return {
    summary: {
      novelCount: reports.length,
      fullyConsistentCount,
      mismatchCount: reports.length - fullyConsistentCount,
    },
    reports,
  }
}

/** 删除 chapters/ 下「有 .txt 但 chapters.json 无对应 id」的孤儿正文 */
export type DeleteOrphanChapterTxtResult = {
  novelId: string
  title: string
  /** 成功删除的 OSS 对象 key */
  deletedKeys: string[]
  /** 删除失败 */
  errors: Array<{ key: string; message: string }>
  /** 校验报告摘要（删除前） */
  orphanCount: number
  /** 因安全策略未执行任何删除时的说明 */
  blockedReason?: string
}

export type DeleteOrphanChapterTxtOptions = {
  /**
   * chapters.json 解析后无任何有效章节 id，但磁盘上仍有 .txt 时，默认**禁止**删除（避免误删整书）。
   * 仅在明确要「以空索引为准清空全部正文」时设为 true。
   */
  allowWhenIndexEmpty?: boolean
}

/**
 * 以当前 chapters.json 为准，删除 OSS orphans：`novels/{id}/chapters/{orphanId}.txt`
 */
export async function deleteOrphanChapterTxtFiles(
  novelId: string,
  options?: DeleteOrphanChapterTxtOptions
): Promise<DeleteOrphanChapterTxtResult> {
  const report = await verifyNovelChapterIndexVsTxtFiles(novelId)
  const emptyErrors = (): DeleteOrphanChapterTxtResult => ({
    novelId,
    title: report.title,
    deletedKeys: [],
    errors: [],
    orphanCount: 0,
  })

  if (report.error) {
    return {
      novelId,
      title: report.title,
      deletedKeys: [],
      errors: [{ key: '*', message: report.error }],
      orphanCount: report.orphanTxtIds.length,
      blockedReason: 'verify_failed',
    }
  }

  if (
    report.uniqueIndexIdCount === 0 &&
    report.orphanTxtIds.length > 0 &&
    !options?.allowWhenIndexEmpty
  ) {
    return {
      novelId,
      title: report.title,
      deletedKeys: [],
      errors: [],
      orphanCount: report.orphanTxtIds.length,
      blockedReason:
        'index_has_no_valid_ids: 当前索引无有效章节 id，若删除孤儿将清空全部正文；如需执行请设置 allowWhenIndexEmpty',
    }
  }

  if (report.orphanTxtIds.length === 0) {
    return {
      ...emptyErrors(),
      title: report.title,
      orphanCount: 0,
    }
  }

  const client = getOSSClient()
  const deletedKeys: string[] = []
  const errors: Array<{ key: string; message: string }> = []

  for (const id of report.orphanTxtIds) {
    const key = `${NOVEL_PREFIX}/${novelId}/chapters/${id}.txt`
    try {
      await client.delete(key)
      deletedKeys.push(key)
    } catch (e) {
      errors.push({ key, message: e instanceof Error ? e.message : String(e) })
    }
  }

  return {
    novelId,
    title: report.title,
    deletedKeys,
    errors,
    orphanCount: report.orphanTxtIds.length,
  }
}

/**
 * 删除 OSS 上全部小说中检测到的孤儿章节 .txt（逐本调用 deleteOrphanChapterTxtFiles）
 */
export async function deleteOrphanChapterTxtFilesForAllNovels(
  options?: DeleteOrphanChapterTxtOptions
): Promise<{ results: DeleteOrphanChapterTxtResult[] }> {
  const metas = await listOSSNovels()
  const results: DeleteOrphanChapterTxtResult[] = []
  for (const m of metas) {
    results.push(await deleteOrphanChapterTxtFiles(m.id, options))
  }
  return { results }
}

/**
 * 删除小说所有数据
 */
export async function deleteNovelFromOSS(novelId: string): Promise<void> {
  const client = getOSSClient()
  const prefix = `${NOVEL_PREFIX}/${novelId}/`
  
  try {
    const objects = await listAllObjects(client, prefix)
    if (objects.length > 0) {
      const files = objects.map(ossObj => ossObj.name)
      for (let i = 0; i < files.length; i += 1000) {
        const batch = files.slice(i, i + 1000)
        await client.deleteMulti(batch)
      }
    }
  } catch (error) {
    console.error('删除小说文件失败:', error)
  }
}

/**
 * 检查OSS配置是否可用
 */
export function isOSSAvailable(): boolean {
  return checkOSSConfig()
}

/**
 * 获取签名URL
 */
export async function getSignedUrl(ossPath: string, expires: number = 3600): Promise<string> {
  const client = getOSSClient()
  return client.signatureUrl(ossPath, { expires })
}
