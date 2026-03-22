import { z } from 'zod'

// Novel status enum
export const novelStatusSchema = z.enum(['draft', 'ongoing', 'completed'])

// Novel genre enum
export const novelGenreSchema = z.enum([
  'fantasy',
  'urban', 
  'scifi',
  'romance',
  'wuxia',
  'history',
  'suspense',
  'other'
])

// Create novel schema - trim first, then validate
export const createNovelSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(100, '标题最多100个字符'),
  description: z.string().trim().max(2000, '简介最多2000个字符').optional().nullable(),
  genre: novelGenreSchema.optional().nullable()
})

// Update novel schema
export const updateNovelSchema = z.object({
  id: z.string().min(1, 'ID不能为空'),
  title: z.string().trim().min(1, '标题不能为空').max(100, '标题最多100个字符').optional(),
  description: z.string().trim().max(2000, '简介最多2000个字符').optional().nullable(),
  genre: novelGenreSchema.optional().nullable(),
  status: novelStatusSchema.optional()
})

// Create chapter schema
export const createChapterSchema = z.object({
  novelId: z.string().min(1, '小说ID不能为空'),
  title: z.string().trim().min(1, '标题不能为空').max(100, '标题最多100个字符'),
  /** 第几章（≥1）；省略则自动为当前最大章号+1 */
  chapterNumber: z.number().int().min(1).optional(),
  order: z.number().int().min(0).optional(),
  content: z.string().max(100000, '章节内容最多100000个字符').optional()
})

// Update chapter schema（novelId：OSS 真相源下用于定位对象键）
export const updateChapterSchema = z.object({
  id: z.string().min(1, '章节ID不能为空'),
  novelId: z.string().min(1, '小说ID不能为空'),
  title: z.string().trim().min(1, '标题不能为空').max(100, '标题最多100个字符').optional(),
  /** 第几章（≥1），与标题正文分开存储 */
  chapterNumber: z.number().int().min(1).optional(),
  content: z.string().max(100000, '章节内容最多100000个字符').optional(),
  wordCount: z.number().int().min(0).optional()
})

// AI continue writing schema
export const aiContinueSchema = z.object({
  content: z.string().min(1, '内容不能为空').max(10000, '内容最多10000个字符'),
  novelTitle: z.string().max(100).optional(),
  chapterTitle: z.string().max(100).optional(),
  genre: z.string().max(50).optional()
})

// AI title generation schema
export const aiTitleSchema = z.object({
  content: z.string().min(50, '内容至少50个字符才能生成标题').max(10000, '内容最多10000个字符')
})

// AI generate outline schema
export const aiGenerateOutlineSchema = z.object({
  title: z.string().trim().min(1, '小说标题不能为空').max(100, '标题最多100个字符'),
  description: z.string().trim().min(20, '简介至少需要20个字符').max(2000, '简介最多2000个字符'),
  genre: z.string().max(50).optional().nullable(),
  totalWords: z.number().int().min(1000, '总字数至少1000字').max(1000000, '总字数最多100万字'),
  chapterCount: z.number().int().min(3, '章节数至少3章').max(500, '章节数最多500章')
})

// AI generate chapter content schema
export const aiGenerateChapterSchema = z.object({
  novelId: z.string().min(1, '小说ID不能为空'),
  chapterIndex: z.number().int().min(0),
  chapterTitle: z.string().min(1, '章节标题不能为空'),
  chapterOutline: z.string().min(1, '章节大纲不能为空'),
  previousContent: z.string().max(500).optional(), // 前一章结尾用于衔接
  storyContext: z.string().max(2000) // 整体故事背景
})

// TTS schema
export const ttsSchema = z.object({
  text: z.string().min(1, '文本不能为空').max(1024, '单次请求最多1024个字符'),
  voice: z.enum(['tongtong', 'chuichui', 'xiaochen', 'douji', 'luodo']).optional(),
  speed: z.number().min(0.5).max(2.0).optional()
})

// Export schema
export const exportSchema = z.object({
  novelId: z.string().min(1, '小说ID不能为空'),
  format: z.enum(['epub', 'pdf']),
  includeCover: z.boolean().default(true),
  includeDescription: z.boolean().default(true),
  fontSize: z.number().int().min(10).max(24).optional().default(14),
  lineHeight: z.number().min(1.0).max(3.0).optional().default(1.8),
  pageMargin: z.number().int().min(20).max(80).optional().default(50),
})

// Helper to validate and return error message
export function validateOrError<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; error: string } {
  try {
    const result = schema.safeParse(data)
    if (result.success) {
      return { success: true, data: result.data }
    }
    // Safely extract error message
    const issues = result.error.issues
    if (issues && issues.length > 0) {
      return { success: false, error: issues[0].message }
    }
    return { success: false, error: '参数验证失败' }
  } catch (e) {
    return { success: false, error: '参数验证失败' }
  }
}
