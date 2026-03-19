import { callAliyunAIWithRetry } from '@/lib/aliyun-ai'

export const OPENING_WORDS = 100
const PHASE_RATIOS = { beginning: 0.15, middle: 0.70, ending: 0.15 }

export interface ChapterPlan {
  index: number
  phase: 'beginning' | 'middle' | 'ending'
  title: string
  outline: string
  estimatedWords: number
}

export interface StoryContext {
  characters: string[]
  recentSummaries: string[]
}

export async function generateStoryStructure(
  title: string,
  description: string,
  genre: string | null,
  totalWords: number,
  chapterCount: number
): Promise<{ beginning: string; middle: string; ending: string }> {
  const genreText = genre ? `这是一部${genre}类型的小说。` : ''
  const prompt = `你是一位专业的小说策划师。

小说标题：${title}
小说简介：${description}
${genreText}
计划总字数：${totalWords}字
章节数量：${chapterCount}章

请为这个故事创作三个阶段的故事发展概述，JSON格式：
{
  "beginning": "开头阶段概述（100-150字）",
  "middle": "经过阶段概述（200-300字）",
  "ending": "结尾阶段概述（100-150字）"
}

只输出JSON，不要其他内容。`

  const content = await callAliyunAIWithRetry([{ role: 'user', content: prompt }], 3, 3000)
  let jsonStr = content.trim()
  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7)
  else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3)
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3)
  return JSON.parse(jsonStr.trim())
}

export async function generateBatchOutlines(
  title: string,
  genre: string | null,
  structure: { beginning: string; middle: string; ending: string },
  startIndex: number,
  batchSize: number,
  totalChapters: number,
  wordsPerChapter: number,
  context: StoryContext
): Promise<ChapterPlan[]> {
  const endIndex = Math.min(startIndex + batchSize, totalChapters)
  const actualBatchSize = endIndex - startIndex
  const beginningEnd = Math.floor(totalChapters * PHASE_RATIOS.beginning)
  const middleEnd = Math.floor(totalChapters * (PHASE_RATIOS.beginning + PHASE_RATIOS.middle))

  let phaseInfo = ''
  if (endIndex <= beginningEnd) phaseInfo = `【开头阶段】${structure.beginning}`
  else if (startIndex >= middleEnd) phaseInfo = `【结尾阶段】${structure.ending}`
  else if (startIndex < beginningEnd && endIndex > beginningEnd)
    phaseInfo = `【开头过渡到经过】开头：${structure.beginning}\n经过：${structure.middle}`
  else if (startIndex < middleEnd && endIndex > middleEnd)
    phaseInfo = `【经过过渡到结尾】经过：${structure.middle}\n结尾：${structure.ending}`
  else phaseInfo = `【经过阶段】${structure.middle}`

  const contextText = context.recentSummaries.length > 0
    ? `\n之前剧情摘要：${context.recentSummaries.slice(-3).join(' -> ')}`
    : ''
  const charactersText = context.characters.length > 0 ? `\n已出现角色：${context.characters.join('、')}` : ''
  const genreText = genre ? `这是一部${genre}类型的小说。` : ''

  const prompt = `为小说生成章节大纲：

小说：${title}
${genreText}
总章节：${totalChapters}章，当前第${startIndex + 1}-${endIndex}章
每章约${wordsPerChapter}字

${phaseInfo}${contextText}${charactersText}

生成${actualBatchSize}个章节大纲，JSON格式：
{
  "chapters": [
    {
      "title": "第X章 标题（4-10字）",
      "outline": "情节概述（50-80字）"
    }
  ]
}

只输出JSON`

  const content = await callAliyunAIWithRetry([{ role: 'user', content: prompt }], 3, 4000)
  let jsonStr = content.trim()
  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7)
  else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3)
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3)
  const data = JSON.parse(jsonStr.trim())

  const getPhase = (i: number): 'beginning' | 'middle' | 'ending' => {
    if (i < beginningEnd) return 'beginning'
    if (i < middleEnd) return 'middle'
    return 'ending'
  }
  return data.chapters.map((ch: { title: string; outline: string }, i: number) => ({
    index: startIndex + i,
    phase: getPhase(startIndex + i),
    title: ch.title,
    outline: ch.outline,
    estimatedWords: wordsPerChapter
  }))
}

export async function generateChapterOpening(
  title: string,
  genre: string | null,
  plan: ChapterPlan,
  context: StoryContext,
  previousContent: string
): Promise<string> {
  const genreText = genre ? `这是一部${genre}类型的小说。` : ''
  const contextText = context.recentSummaries.length > 0
    ? `\n之前剧情：${context.recentSummaries.slice(-3).join(' -> ')}`
    : ''
  const charactersText = context.characters.length > 0 ? `\n已出现角色：${context.characters.join('、')}` : ''
  const previousText = previousContent ? `\n前章结尾衔接：${previousContent.slice(-200)}` : ''

  const systemPrompt = `你是一位专业的小说作家，擅长为章节写出吸引人的开头。
请根据章节大纲创作【本章的开头部分】，要求：
1. 只写开头的第一个自然段或前几句，不要写完整章节
2. 内容要有画面感和情绪张力，抓住读者
3. 只输出小说正文内容，不要章节标题和其他说明
4. 字数控制在约${OPENING_WORDS}字左右`

  const userPrompt = `小说：${title}
${genreText}${contextText}${charactersText}${previousText}

章节：${plan.title}
大纲：${plan.outline}

请创作本章开头：`

  return callAliyunAIWithRetry(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    3,
    3000
  )
}

export async function generateFullChapter(
  title: string,
  genre: string | null,
  plan: ChapterPlan,
  structure: { beginning: string; middle: string; ending: string },
  context: StoryContext,
  previousContent: string
): Promise<string> {
  const genreText = genre ? `这是一部${genre}类型的小说。` : ''
  const contextText = context.recentSummaries.length > 0
    ? `之前剧情摘要：${context.recentSummaries.slice(-3).join(' -> ')}`
    : ''
  const charactersText = context.characters.length > 0 ? `已出现角色：${context.characters.join('、')}` : ''
  const previousText = previousContent ? `前一章结尾：\n${previousContent.slice(-500)}` : ''

  const storyContext = `小说：${title}
${genreText}
故事结构：开头 ${structure.beginning} | 经过 ${structure.middle} | 结尾 ${structure.ending}
${contextText}
${charactersText}
${previousText}`.trim()

  const systemPrompt = `你是一位专业的小说作家，擅长创作引人入胜的故事内容。
请根据章节大纲创作小说内容，要求：
1. 内容要丰富生动，有细节描写
2. 人物对话要自然，符合角色性格
3. 情节发展要符合大纲，但可以适当展开
4. 文末要有适当的悬念或过渡，为下一章铺垫
5. 只输出小说正文内容，不要章节标题和其他说明
6. 字数控制在800-1500字左右`

  const userPrompt = `故事背景：
${storyContext}

本章信息：
章节标题：${plan.title}
章节大纲：${plan.outline}

请创作本章内容：`

  return callAliyunAIWithRetry(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    3,
    4000
  )
}

export async function generateSummary(content: string): Promise<string> {
  const prompt = `为以下内容生成摘要（50字内，包含主要事件）：

${content.slice(0, 1000)}

只输出摘要`
  return callAliyunAIWithRetry([{ role: 'user', content: prompt }], 2, 2000, { maxTokens: 150 })
}
