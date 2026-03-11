import { NextRequest, NextResponse } from 'next/server'
import { getZAI } from '@/lib/zai'
import { aiContinueSchema, validateOrError } from '@/lib/validations/novel'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Validate input
    const validation = validateOrError(aiContinueSchema, body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    
    const { content, novelTitle, chapterTitle, genre } = validation.data
    
    // Get last 500 characters for context
    const lastContent = content.slice(-500)
    
    // Use singleton ZAI instance
    const zai = await getZAI()
    
    const genreText = genre ? `这是一部${genre}小说。` : ''
    
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content: `你是一位专业的小说作家助手，擅长续写和创作小说内容。
${genreText}
请根据已有内容，自然地续写故事。要求：
1. 保持风格一致
2. 情节自然流畅
3. 不要重复已有内容
4. 续写100-300字左右
5. 只输出续写的内容，不要其他说明`
        },
        {
          role: 'user',
          content: `小说标题：${novelTitle || '未命名'}
章节标题：${chapterTitle || '未命名'}

已有内容（最后部分）：
${lastContent}

请续写接下来的内容：`
        }
      ],
      thinking: { type: 'disabled' }
    })
    
    const suggestion = completion.choices[0]?.message?.content
    
    if (!suggestion) {
      return NextResponse.json({ success: false, error: 'AI failed to generate content' }, { status: 500 })
    }
    
    return NextResponse.json({ success: true, suggestion })
  } catch (error) {
    console.error('AI continue error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'AI generation failed' 
    }, { status: 500 })
  }
}
