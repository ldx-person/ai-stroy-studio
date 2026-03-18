import OSS from 'ali-oss'

/**
 * OSS数据结构设计
 * 
 * novels/{novelId}/
 * ├── novel.json           # 小说元数据（标题、类型、状态、字数、创建时间等）
 * ├── description.txt      # 简介
 * ├── outline.json         # 大纲
 * ├── characters.json      # 角色列表
 * ├── chapters.json        # 章节索引（id, title, order, wordCount等）
 * └── chapters/
 *     └── {chapterId}.txt  # 章节内容
 */

// OSS配置
const ossConfig = {
  region: process.env.OSS_REGION || 'oss-cn-beijing',
  accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
  bucket: process.env.OSS_BUCKET || 'ai-story-stroe',
}

// 检查配置是否完整
function checkOSSConfig(): boolean {
  return !!(ossConfig.accessKeyId && ossConfig.accessKeySecret && ossConfig.bucket)
}

// 创建OSS客户端
let ossClient: OSS | null = null

function getOSSClient(): OSS {
  if (!ossClient) {
    if (!checkOSSConfig()) {
      throw new Error('OSS配置不完整，请检查环境变量')
    }
    ossClient = new OSS(ossConfig)
  }
  return ossClient
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
  
  // 1. 保存小说元数据
  const novelMeta: OSSNovelMeta = {
    id: novelId,
    title: data.title,
    genre: data.genre || null,
    status: data.status || 'draft',
    wordCount: data.wordCount || 0,
    createdAt: now,
    updatedAt: now
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
    const chaptersIndex: OSSChapterMeta[] = data.chapters.map(ch => ({
      id: ch.id,
      title: ch.title,
      wordCount: ch.wordCount,
      order: ch.order,
      isPublished: ch.isPublished,
      createdAt: ch.createdAt || now,
      updatedAt: now
    }))
    
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
      chapters = JSON.parse(chaptersIndexResult.content.toString('utf-8'))
      chapters.sort((a, b) => a.order - b.order)
    } catch {
      // 章节索引可能不存在
    }
    
    return { description, chapters }
  } catch (error) {
    console.error('从OSS获取小说元数据失败:', error)
    return null
  }
}

/**
 * 从OSS获取单个小说完整数据
 */
export async function getNovelFromOSS(novelId: string): Promise<OSSNovelFull | null> {
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
      const chaptersIndex: OSSChapterMeta[] = JSON.parse(chaptersIndexResult.content.toString('utf-8'))
      
      // 读取每个章节的内容
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
    // 第一步：用 delimiter 列出所有小说目录（只返回目录前缀，不列出所有文件）
    const result = await client.list({
      prefix: `${NOVEL_PREFIX}/`,
      delimiter: '/',
      'max-keys': 1000
    })
    
    const novels: OSSNovelMeta[] = []
    
    // result.prefixes 包含所有子目录，如 ['novels/abc123/', 'novels/def456/']
    const prefixes: string[] = result.prefixes || []
    
    if (prefixes.length === 0) {
      return []
    }
    
    // 第二步：并发读取所有 novel.json 文件（最多 10 个并发）
    const CONCURRENCY = 10
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
    
    // 按更新时间排序
    novels.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    
    return novels
  } catch (error) {
    console.error('列出OSS小说失败:', error)
    return []
  }
}

/**
 * 迁移旧数据结构
 */
async function migrateOldStructure(novelId: string): Promise<OSSNovelFull | null> {
  const client = getOSSClient()
  const prefix = `${NOVEL_PREFIX}/${novelId}/`
  
  try {
    // 列出该小说目录下的所有文件
    const result = await client.list({ prefix })
    
    if (!result.objects || result.objects.length === 0) {
      return null
    }
    
    const now = new Date().toISOString()
    const chapters: Array<OSSChapterMeta & { content: string }> = []
    let description: string | null = null
    
    // 读取所有文件
    for (const ossObj of result.objects) {
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
          chapters.push({
            id: chapterId,
            title: `第${chapters.length + 1}章`,
            wordCount: content.content.length,
            order: chapters.length,
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
  
  // 更新章节索引
  await updateChapterInIndex(novelId, chapterId, { wordCount: content.length })
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
    chapters = JSON.parse(result.content.toString('utf-8'))
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
    chapters = JSON.parse(result.content.toString('utf-8'))
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

/**
 * 删除小说所有数据
 */
export async function deleteNovelFromOSS(novelId: string): Promise<void> {
  const client = getOSSClient()
  const prefix = `${NOVEL_PREFIX}/${novelId}/`
  
  try {
    // 列出所有文件
    const result = await client.list({ prefix })
    
    if (result.objects && result.objects.length > 0) {
      // 批量删除
      const files = result.objects.map(ossObj => ossObj.name)
      await client.deleteMulti(files)
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
