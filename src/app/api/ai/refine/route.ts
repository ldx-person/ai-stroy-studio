import { NextRequest, NextResponse } from 'next/server'
import { callAliyunAIWithRetry, ChatMessage } from '@/lib/aliyun-ai'
import { z } from 'zod'

const refineSchema = z.object({
  content: z.string().min(1, '内容不能为空').max(10000, '内容最多10000个字符'),
  mode: z.enum(['polish', 'shorten', 'expand', 'style']).default('polish'),
  styleHint: z.string().max(200).optional().nullable(),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = refineSchema.safeParse(body)

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      return NextResponse.json(
        { success: false, error: firstIssue?.message || '参数验证失败' },
        { status: 400 }
      )
    }

    const { content, mode, styleHint } = parsed.data

    let taskDescription = ''
    switch (mode) {
      case 'polish':
        taskDescription = '对下面的小说内容进行润色和优化表达，保持原意不变：'
        break
      case 'shorten':
        taskDescription = '在保留关键信息和情节的前提下，将下面的内容精简到更紧凑的篇幅：'
        break
      case 'expand':
        taskDescription = '在保持原剧情不变的基础上，丰富细节、对话和环境描写，适度扩写下面的内容：'
        break
      case 'style':
        taskDescription = `按照提示的文风进行改写，保持核心剧情不变。文风提示：「${
          styleHint || '更有画面感、更有代入感的网络小说文风'
        }」。请改写下面的内容：`
        break
    }

    const systemPrompt = `你是一位专业的中文小说写作助手，擅长润色、精简、扩写和风格改写。
在处理文本时，请：
1. 保持故事核心信息和情节逻辑不变
2. 优化语句通顺度和表达自然度
3. 符合中文网络小说常见的表达习惯
4. 只输出修改后的正文内容，不要任何解释或额外说明`

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${taskDescription}

原始内容：
${content}`,
      },
    ]

    const refined = await callAliyunAIWithRetry(messages, 3, 2000)

    return NextResponse.json({ success: true, result: refined.trim() })
  } catch (error) {
    console.error('AI refine error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'AI refine failed',
      },
      { status: 500 }
    )
  }
}

