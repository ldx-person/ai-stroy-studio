import { NextRequest, NextResponse } from 'next/server'
import { callAliyunAIWithRetry, ChatMessage } from '@/lib/aliyun-ai'
import { z } from 'zod'

// AI title generation schema
const titleSchema = z.object({
  content: z.string().min(50, '内容至少50个字符才能生成标题').max(10000, '内容最多10000个字符')
})

// Helper to validate
function validate(data: unknown): { success: true; data: z.infer<typeof titleSchema> } | { success: false; error: string } {
  try {
    const result = titleSchema.safeParse(data)
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
    
    // Validate input
    const validation = validate(body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    
    const { content } = validation.data
    
    // Get first 300 characters for context
    const firstContent = content.slice(0, 300)
    
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一位专业的小说标题创作助手。
请根据章节内容，生成一个吸引人的章节标题。
标题要求：
1. 简洁有力，10个字以内
2. 能概括章节主题
3. 有吸引力，引起读者兴趣
4. 格式如"第X章 标题"或直接"标题"
5. 只输出标题，不要其他内容`
      },
      {
        role: 'user',
        content: `章节内容（开头部分）：
${firstContent}

请为这个章节生成一个标题：`
      }
    ]
    
    const title = await callAliyunAIWithRetry(messages, 3, 2000)
    
    // Clean up the title
    const cleanTitle = title.trim().replace(/^[""""'']+|[""""'']+$/g, '')
    
    return NextResponse.json({ success: true, title: cleanTitle })
  } catch (error) {
    console.error('AI title error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'AI generation failed' 
    }, { status: 500 })
  }
}
