import OSS from 'ali-oss'

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

/**
 * 上传小说内容到OSS
 * @param novelId 小说ID
 * @param chapterId 章节ID
 * @param content 章节内容
 * @returns OSS文件路径
 */
export async function uploadChapterContent(
  novelId: string,
  chapterId: string,
  content: string
): Promise<string> {
  const client = getOSSClient()
  const ossPath = `${NOVEL_PREFIX}/${novelId}/chapters/${chapterId}.txt`
  
  try {
    await client.put(ossPath, Buffer.from(content, 'utf-8'))
    return ossPath
  } catch (error) {
    console.error('上传章节内容到OSS失败:', error)
    throw new Error('上传章节内容失败')
  }
}

/**
 * 从OSS下载章节内容
 * @param ossPath OSS文件路径
 * @returns 章节内容
 */
export async function downloadChapterContent(ossPath: string): Promise<string> {
  const client = getOSSClient()
  
  try {
    const result = await client.get(ossPath)
    return result.content.toString('utf-8')
  } catch (error) {
    console.error('从OSS下载章节内容失败:', error)
    throw new Error('下载章节内容失败')
  }
}

/**
 * 删除OSS上的章节内容
 * @param ossPath OSS文件路径
 */
export async function deleteChapterContent(ossPath: string): Promise<void> {
  const client = getOSSClient()
  
  try {
    await client.delete(ossPath)
  } catch (error) {
    console.error('从OSS删除章节内容失败:', error)
    // 不抛出错误，因为文件可能不存在
  }
}

/**
 * 删除小说的所有OSS文件
 * @param novelId 小说ID
 */
export async function deleteNovelFiles(novelId: string): Promise<void> {
  const client = getOSSClient()
  const prefix = `${NOVEL_PREFIX}/${novelId}/`
  
  try {
    // 列出所有文件
    const result = await client.list({ prefix })
    
    if (result.objects && result.objects.length > 0) {
      // 批量删除
      const files = result.objects.map(obj => obj.name)
      await client.deleteMulti(files)
    }
  } catch (error) {
    console.error('删除小说文件失败:', error)
    // 不抛出错误，继续执行
  }
}

/**
 * 获取OSS文件的签名URL（用于临时访问）
 * @param ossPath OSS文件路径
 * @param expires 过期时间（秒），默认1小时
 * @returns 签名URL
 */
export async function getSignedUrl(ossPath: string, expires: number = 3600): Promise<string> {
  const client = getOSSClient()
  
  try {
    return client.signatureUrl(ossPath, { expires })
  } catch (error) {
    console.error('获取签名URL失败:', error)
    throw new Error('获取文件访问链接失败')
  }
}

/**
 * 上传小说简介到OSS
 * @param novelId 小说ID
 * @param description 简介
 * @returns OSS文件路径
 */
export async function uploadNovelDescription(
  novelId: string,
  description: string
): Promise<string> {
  const client = getOSSClient()
  const ossPath = `${NOVEL_PREFIX}/${novelId}/description.txt`
  
  try {
    await client.put(ossPath, Buffer.from(description, 'utf-8'))
    return ossPath
  } catch (error) {
    console.error('上传小说简介到OSS失败:', error)
    throw new Error('上传简介失败')
  }
}

/**
 * 从OSS下载小说简介
 * @param ossPath OSS文件路径
 * @returns 简介
 */
export async function downloadNovelDescription(ossPath: string): Promise<string> {
  return downloadChapterContent(ossPath) // 使用相同的下载逻辑
}

/**
 * 检查OSS配置是否可用
 */
export function isOSSAvailable(): boolean {
  return checkOSSConfig()
}

/**
 * 列出OSS中所有小说文件夹
 * @returns 小说ID列表
 */
export async function listOSSNovels(): Promise<string[]> {
  const client = getOSSClient()
  
  try {
    const result = await client.list({
      prefix: `${NOVEL_PREFIX}/`,
      delimiter: '/'
    })
    
    // 提取小说ID
    const novelIds: string[] = []
    if (result.prefixes) {
      for (const prefix of result.prefixes) {
        // prefix格式: novels/{novelId}/
        const match = prefix.match(new RegExp(`${NOVEL_PREFIX}/([^/]+)/`))
        if (match && match[1]) {
          novelIds.push(match[1])
        }
      }
    }
    
    return novelIds
  } catch (error) {
    console.error('列出OSS小说失败:', error)
    throw new Error('列出OSS小说失败')
  }
}

/**
 * 获取OSS中小说的所有数据
 * @param novelId 小说ID
 * @returns 小说数据
 */
export async function getOSSNovelData(novelId: string): Promise<{
  description: string | null
  outline: unknown | null
  chapters: Array<{ ossPath: string; content: string }>
}> {
  const client = getOSSClient()
  const prefix = `${NOVEL_PREFIX}/${novelId}/`
  
  try {
    const result = await client.list({ prefix })
    
    const data = {
      description: null as string | null,
      outline: null as unknown | null,
      chapters: [] as Array<{ ossPath: string; content: string }>
    }
    
    if (!result.objects) {
      return data
    }
    
    for (const obj of result.objects) {
      const fileName = obj.name.replace(prefix, '')
      
      if (fileName === 'description.txt') {
        try {
          const content = await client.get(obj.name)
          data.description = content.content.toString('utf-8')
        } catch (e) {
          console.error('读取简介失败:', e)
        }
      } else if (fileName === 'outline.json') {
        try {
          const content = await client.get(obj.name)
          data.outline = JSON.parse(content.content.toString('utf-8'))
        } catch (e) {
          console.error('读取大纲失败:', e)
        }
      } else if (fileName.startsWith('chapters/') && fileName.endsWith('.txt')) {
        try {
          const content = await client.get(obj.name)
          data.chapters.push({
            ossPath: obj.name,
            content: content.content.toString('utf-8')
          })
        } catch (e) {
          console.error('读取章节失败:', e)
        }
      }
    }
    
    // 按文件名排序章节
    data.chapters.sort((a, b) => a.ossPath.localeCompare(b.ossPath))
    
    return data
  } catch (error) {
    console.error('获取OSS小说数据失败:', error)
    throw new Error('获取OSS小说数据失败')
  }
}

/**
 * 上传小说大纲到OSS
 * @param novelId 小说ID
 * @param outline 大纲JSON
 * @returns OSS文件路径
 */
export async function uploadNovelOutline(
  novelId: string,
  outline: unknown
): Promise<string> {
  const client = getOSSClient()
  const ossPath = `${NOVEL_PREFIX}/${novelId}/outline.json`
  
  try {
    await client.put(ossPath, Buffer.from(JSON.stringify(outline, null, 2), 'utf-8'))
    return ossPath
  } catch (error) {
    console.error('上传小说大纲到OSS失败:', error)
    throw new Error('上传大纲失败')
  }
}

/**
 * 从OSS下载小说大纲
 * @param ossPath OSS文件路径
 * @returns 大纲对象
 */
export async function downloadNovelOutline<T>(ossPath: string): Promise<T> {
  const content = await downloadChapterContent(ossPath)
  return JSON.parse(content) as T
}
