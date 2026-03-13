import { NextRequest, NextResponse } from 'next/server'
import { callAliyunAIWithRetry } from '@/lib/ai'
import { z } from 'zod'

// AI generate chapter content schema
const chapterSchema = z.object({
  novelId: z.string().min(1, '小说ID不能为空'),
  chapterIndex: z.number().int().min(0),
  chapterTitle: z.string().min(1, '章节标题不能为空'),
  chapterOutline: z.string().min(1, '章节大纲不能为空'),
  previousContent: z.string().max(500).optional(),
  storyContext: z.string().max(2000)
})

// Helper to validate
function validate(data: unknown): { success: true; data: z.infer<typeof chapterSchema> } | { success: false; error: string } {
  try {
    const result = chapterSchema.safeParse(data)
    if (result.success) {
      return { success: true, data: result.data }
    }
    const issues = result.error.issues
    if (issues && issues.length > 0) {
      return { success: false, error: issues[0].message }
    }
    return { success: false, error: '参数验证失败' }
  } catch {
    return { success: false, error: '参数验证失败' }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const validation = validate(body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    
    const { chapterIndex, chapterTitle, chapterOutline, previousContent, storyContext } = validation.data
    
    const previousContentText = previousContent 
      ? `\n前一章结尾：\n${previousContent}\n`
      : ''
    
    const systemPrompt = `你是一位专业的小说作家，擅长创作引人入胜的故事内容。
请根据章节大纲创作小说内容，要求：
1. 内容要丰富生动，有细节描写
2. 人物对话要自然，符合角色性格
3. 情节发展要符合大纲，但可以适当展开
4. 场景描写要有画面感
5. 文末要有适当的悬念或过渡，为下一章铺垫
6. 只输出小说正文内容，不要章节标题和其他说明
7. 字数控制在800-1500字左右`

    const userPrompt = `故事背景：
${storyContext}
${previousContentText}
本章信息：
章节标题：${chapterTitle}
章节大纲：${chapterOutline}

请创作本章内容：`

    const content = await callAliyunAIWithRetry([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], 3, 3000)
    
    return NextResponse.json({ 
      success: true, 
      content,
      wordCount: content.length,
      chapterIndex
    })
  } catch (error) {
    console.error('Generate chapter error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : '生成章节失败' 
    }, { status: 500 })
  }
}
