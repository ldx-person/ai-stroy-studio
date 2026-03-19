import { NextRequest, NextResponse } from 'next/server'
import { callAliyunAIWithRetry, ChatMessage } from '@/lib/aliyun-ai'
import { z } from 'zod'
import { getStoryBibleFromOSS, isOSSAvailable } from '@/lib/oss'

const actionSchema = z.object({
  novelId: z.string().optional(),
  chapterId: z.string().optional(),
  action: z.enum(['rewrite', 'continue', 'title', 'opening', 'describe', 'story-bible']).default('rewrite'),
  input: z.object({
    scope: z.enum(['selection', 'cursor', 'chapter']).default('selection'),
    text: z.string().min(1, '内容不能为空').max(12000, '内容最多12000个字符'),
  }),
  options: z
    .object({
      mode: z.enum(['polish', 'shorten', 'expand']).optional(),
      subAction: z.enum(['environment', 'emotion', 'action', 'dialogue']).optional(),
      variants: z.number().int().min(1).max(5).default(1),
      length: z.enum(['100', '300']).optional(),
      style: z.string().max(50).optional(),
    })
    .default({ variants: 1 }),
})


function buildRewritePrompt(mode: 'polish' | 'shorten' | 'expand', scope: 'selection' | 'chapter') {
  const scopeText = scope === 'chapter' ? '章节正文' : '选中文本'
  switch (mode) {
    case 'polish':
      return {
        system: `你是一位专业的中文小说写作助手，擅长润色与提升表达。
请对用户提供的${scopeText}进行润色优化，要求：
1. 保持原意与剧情逻辑不变
2. 语句更通顺、更有画面感
3. 不要引入新的设定或人物
4. 只输出修改后的正文，不要解释`,
        userPrefix: `请润色以下${scopeText}：`,
      }
    case 'shorten':
      return {
        system: `你是一位专业的中文小说写作助手，擅长精简文本。
请在保留关键信息与情节逻辑的前提下精简用户提供的${scopeText}，要求：
1. 删除冗余与重复表达
2. 保持叙事连贯与风格一致
3. 不要引入新的设定或人物
4. 只输出精简后的正文，不要解释`,
        userPrefix: `请精简以下${scopeText}：`,
      }
    case 'expand':
      return {
        system: `你是一位专业的中文小说写作助手，擅长扩写与描写增强。
请在不改变核心剧情的前提下扩写用户提供的${scopeText}，要求：
1. 增加场景、动作、情绪与必要的对话细节
2. 不要改变事件顺序与关键信息
3. 不要引入新的设定或人物
4. 只输出扩写后的正文，不要解释`,
        userPrefix: `请扩写以下${scopeText}：`,
      }
  }
}

function buildContinuePrompt(length: '100' | '300' | undefined) {
  const target = length === '300' ? '200-350字' : '100-180字'
  return {
    system: `你是一位专业的中文小说作家助手，擅长续写与推进情节。
请根据用户提供的已有内容，自然续写接下来的内容，要求：
1. 保持文风一致
2. 不要重复已有内容
3. 推进一个小的剧情点或制造一个小悬念
4. 只输出续写正文，不要解释
5. 长度控制在${target}`,
    userPrefix: '已有内容（末尾部分）：',
  }
}

function buildTitlePrompt() {
  return {
    system: `你是一位专业的小说章节标题创作助手。
请根据章节内容生成一个吸引人的章节标题，要求：
1. 10个字以内（中文）
2. 能概括章节核心冲突或亮点
3. 只输出标题，不要解释`,
    userPrefix: '章节内容（节选）：',
  }
}

function buildOpeningPrompt(style?: string, length?: '100' | '300') {
  const target = length === '300' ? '200-350字' : '约100字'
  const styleHint = style ? `文风提示：${style}\n` : ''
  return {
    system: `你是一位专业的中文小说作家，擅长写章节开头。
${styleHint}请根据用户给出的章节大纲或要点，写出本章开头，要求：
1. 只写开头第一段/前几句，不要写完整章节
2. 有画面感与情绪张力，快速进入情境
3. 可以埋一个钩子/矛盾，但不要完全展开
4. 只输出正文，不要标题与解释
5. 长度控制在${target}`,
    userPrefix: '章节要点/大纲：',
  }
}

type DescribeSubAction = 'environment' | 'emotion' | 'action' | 'dialogue'

function buildDescribePrompt(subAction: DescribeSubAction, style?: string, length?: '100' | '300') {
  const target = length === '300' ? '200-350字' : '100-180字'
  const styleHint = style ? `文风提示：${style}\n` : ''

  const prompts: Record<DescribeSubAction, { focus: string; example: string }> = {
    environment: {
      focus: '环境描写增强：天气、光线、声音、气味、空间氛围',
      example: '把"房间里很暗"改成"烛火摇曳，在斑驳的墙纸上投下诡异的影子，窗外传来雨打芭蕉的声响"',
    },
    emotion: {
      focus: '情绪描写增强：内心活动、微表情、肢体语言、心理张力',
      example: '把"她很生气"改成"她的指甲深深掐进掌心，嘴角却勾起一抹冷笑，眼底翻涌着压抑的怒火"',
    },
    action: {
      focus: '动作描写增强：动作分解、节奏变化、力量感、画面感',
      example: '把"他跑了过来"改成"他三步并作两步冲过来，衣角带起一阵风，脚步在青石板上踩出急促的声响"',
    },
    dialogue: {
      focus: '对话描写增强：语气变化、潜台词、对话节奏、符合人物性格',
      example: '把"他说好的"改成"他顿了顿，声音低下去："……好。"那尾音像是从牙缝里挤出来的"',
    },
  }

  const { focus, example } = prompts[subAction]

  return {
    system: `你是一位专业的中文小说写作助手，擅长${focus}。
${styleHint}请在不改变核心事实的前提下，对用户提供的文本进行"${focus}"，要求：
1. ${focus}，增加感官细节（视觉/听觉/触觉/嗅觉等）
2. 不要新增人物与重大设定
3. 只输出增强后的正文，不要解释
4. 长度控制在${target}

示例：${example}`,
    userPrefix: '原始文本：',
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = actionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || '参数验证失败' },
        { status: 400 }
      )
    }

    const { novelId, action, input, options } = parsed.data

    // 自动注入作品档案（Story Bible），用于减少长篇漂移
    let storyBibleText = ''
    if (novelId && isOSSAvailable()) {
      const storyBible = await getStoryBibleFromOSS(novelId)
      if (storyBible) {
        storyBibleText = `\n\n【作品档案（必须遵守）】\n${JSON.stringify(storyBible)}`
      }
    }

    const variants = options.variants
    const candidates: Array<{ text: string }> = []

    const run = async (messages: ChatMessage[], temp: number) => {
      if (storyBibleText && messages[0]?.role === 'system') {
        messages = [{ ...messages[0], content: messages[0].content + storyBibleText }, ...messages.slice(1)]
      }
      const text = await callAliyunAIWithRetry(messages, 3, 2000, { temperature: temp })
      const cleaned = (text || '').trim()
      if (cleaned) candidates.push({ text: cleaned })
    }

    if (action === 'rewrite') {
      const mode = options.mode || 'polish'
      const scope = input.scope === 'chapter' ? 'chapter' : 'selection'
      const { system, userPrefix } = buildRewritePrompt(mode, scope)
      const makeMessages = (): ChatMessage[] => [
        { role: 'system', content: system },
        { role: 'user', content: `${userPrefix}\n\n${input.text}` },
      ]
      for (let i = 0; i < variants; i++) {
        await run(makeMessages(), i === 0 ? 0.6 : 0.8)
      }
    } else if (action === 'continue') {
      const { system, userPrefix } = buildContinuePrompt(options.length)
      const tail = input.text.slice(-800)
      const makeMessages = (): ChatMessage[] => [
        { role: 'system', content: system },
        { role: 'user', content: `${userPrefix}\n${tail}\n\n请续写：` },
      ]
      for (let i = 0; i < variants; i++) {
        await run(makeMessages(), i === 0 ? 0.7 : 0.9)
      }
    } else if (action === 'title') {
      const { system, userPrefix } = buildTitlePrompt()
      const head = input.text.slice(0, 600)
      const makeMessages = (): ChatMessage[] => [
        { role: 'system', content: system },
        { role: 'user', content: `${userPrefix}\n${head}\n\n请生成标题：` },
      ]
      // title 一般只要 1 个
      await run(makeMessages(), 0.6)
    } else if (action === 'opening') {
      const { system, userPrefix } = buildOpeningPrompt(options.style, options.length)
      const makeMessages = (): ChatMessage[] => [
        { role: 'system', content: system },
        { role: 'user', content: `${userPrefix}\n${input.text}\n\n请写开头：` },
      ]
      for (let i = 0; i < variants; i++) {
        await run(makeMessages(), i === 0 ? 0.7 : 0.9)
      }
    } else if (action === 'describe') {
      const subAction = (options.subAction || 'environment') as DescribeSubAction
      const { system, userPrefix } = buildDescribePrompt(subAction, options.style, options.length)
      const makeMessages = (): ChatMessage[] => [
        { role: 'system', content: system },
        { role: 'user', content: `${userPrefix}\n${input.text}\n\n请增强描写：` },
      ]
      for (let i = 0; i < variants; i++) {
        await run(makeMessages(), i === 0 ? 0.7 : 0.9)
      }
    } else if (action === 'story-bible') {
      const system = `你是一位专业的小说设定助手，擅长创建作品档案（Story Bible）。
请根据用户提供的小说标题和简介，生成完整的作品档案，包括：
1. characters: 角色卡数组，每个角色包含 {id, name, role(protagonist/supporting/antagonist/other), personality, motivation, speech, relationships, appearance, background}
2. worldRules: 世界观设定数组，每个包含 {id, name, description, constraints}
3. timeline: 时间线数组，每个包含 {id, chapter, event, impact}
4. styleGuide: 文风规则 {pov, tense, tone, taboos[]}

要求：
- 只输出纯 JSON，不要 markdown 代码块标记
- 角色要有细节，性格、动机、说话风格都要具体
- 世界观要符合小说类型
- 时间线按章节顺序排列`
      const makeMessages = (): ChatMessage[] => [
        { role: 'system', content: system },
        { role: 'user', content: `请根据以下信息生成作品档案（JSON格式）：\n\n${input.text}` },
      ]
      await run(makeMessages(), 0.7)
    }

    if (candidates.length === 0) {
      return NextResponse.json({ success: false, error: 'AI 返回为空，请重试' }, { status: 500 })
    }

    return NextResponse.json({ success: true, candidates })
  } catch (error) {
    console.error('AI action error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'AI action failed' },
      { status: 500 }
    )
  }
}
