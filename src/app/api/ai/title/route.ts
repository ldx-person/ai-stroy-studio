import { NextRequest, NextResponse } from 'next/server'
import { getZAI } from '@/lib/zai'
import { aiTitleSchema, validateOrError } from '@/lib/validations/novel'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Validate input
    const validation = validateOrError(aiTitleSchema, body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    
    const { content } = validation.data
    
    // Get first 300 characters for context
    const previewContent = content.slice(0, 300)
    
    // Use singleton ZAI instance
    const zai = await getZAI()
    
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content: `你是一位专业的小说作家助手，擅长为章节起标题。
请根据章节内容，生成一个简洁、吸引人的章节标题。
要求：
1. 标题要概括章节主要内容或突出亮点
2. 格式可以是"第X章 标题"或直接"标题"
3. 标题长度在2-10个字之间
4. 只输出标题，不要其他内容`
        },
        {
          role: 'user',
          content: `章节内容预览：
${previewContent}

请为这个章节生成一个标题：`
        }
      ],
      thinking: { type: 'disabled' }
    })
    
    let title = completion.choices[0]?.message?.content?.trim()
    
    if (!title) {
      return NextResponse.json({ success: false, error: 'AI failed to generate title' }, { status: 500 })
    }
    
    // Clean up title - remove quotes if present
    title = title.replace(/["""'']/g, '').trim()
    
    // Limit title length
    if (title.length > 20) {
      title = title.slice(0, 20)
    }
    
    return NextResponse.json({ success: true, title })
  } catch (error) {
    console.error('AI title generation error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'AI generation failed' 
    }, { status: 500 })
  }
}
