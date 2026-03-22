import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { callAliyunAIWithRetry } from '@/lib/aliyun-ai'
import { saveChapterContent, updateChapterInIndex, getNovelMetaFromOSS } from '@/lib/oss'
import { recomputeNovelWordCountFromOss } from '@/lib/novel-oss-helpers'
import { z } from 'zod'

// 请求验证
const requestSchema = z.object({
  novelId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(20),
  genre: z.string().optional().nullable(),
  totalWords: z.number().int().min(1000).max(1000000),
  chapterCount: z.number().int().min(3).max(500),
  generateMode: z.enum(['full', 'opening']).optional().default('full')
})

// 配置
const BATCH_SIZE = 3
// 每章只生成开头（约100字），不生成整章全文
const OPENING_WORDS_PER_CHAPTER = 100

const PHASE_RATIOS = {
  beginning: 0.15,
  middle: 0.70,
  ending: 0.15
}

interface ChapterPlan {
  index: number
  phase: 'beginning' | 'middle' | 'ending'
  title: string
  outline: string
  estimatedWords: number
}

interface StoryContext {
  characters: string[]
  recentSummaries: string[]
}

// SSE编码器
const encoder = new TextEncoder()

function sendEvent(controller: ReadableStreamDefaultController, event: string, data: object) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  controller.enqueue(encoder.encode(message))
}

// 生成故事结构
async function generateStoryStructure(
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
  "beginning": "开头阶段概述（100-150字）：主要人物的登场和背景介绍，故事的起点和初始冲突",
  "middle": "经过阶段概述（200-300字）：故事的主要发展和转折，角色成长和关系变化，核心冲突的展开",
  "ending": "结尾阶段概述（100-150字）：高潮事件和最终对决，悬念的解答和收尾"
}

只输出JSON，不要其他内容。`

  const content = await callAliyunAIWithRetry([{ role: 'user', content: prompt }], 3, 3000)

  let jsonStr = content.trim()
  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7)
  else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3)
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3)
  
  return JSON.parse(jsonStr.trim())
}

// 生成章节大纲
async function generateBatchOutlines(
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
  if (endIndex <= beginningEnd) {
    phaseInfo = `【开头阶段】${structure.beginning}`
  } else if (startIndex >= middleEnd) {
    phaseInfo = `【结尾阶段】${structure.ending}`
  } else if (startIndex < beginningEnd && endIndex > beginningEnd) {
    phaseInfo = `【开头过渡到经过】开头：${structure.beginning}\n经过：${structure.middle}`
  } else if (startIndex < middleEnd && endIndex > middleEnd) {
    phaseInfo = `【经过过渡到结尾】经过：${structure.middle}\n结尾：${structure.ending}`
  } else {
    phaseInfo = `【经过阶段】${structure.middle}`
  }
  
  const contextText = context.recentSummaries.length > 0
    ? `\n之前剧情摘要：${context.recentSummaries.slice(-3).join(' -> ')}`
    : ''
  
  const charactersText = context.characters.length > 0
    ? `\n已出现角色：${context.characters.join('、')}`
    : ''
  
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
      "title": "第X章 标题（4-10字，吸引人）",
      "outline": "情节概述（50-80字，具体有细节）"
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
  
  const getPhase = (index: number): 'beginning' | 'middle' | 'ending' => {
    if (index < beginningEnd) return 'beginning'
    if (index < middleEnd) return 'middle'
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

// 生成章节开头（约100字）
async function generateChapterOpening(
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
  const charactersText = context.characters.length > 0
    ? `\n已出现角色：${context.characters.join('、')}`
    : ''
  const previousText = previousContent
    ? `\n前章结尾衔接：${previousContent.slice(-200)}`
    : ''
  
  const systemPrompt = `你是一位专业的小说作家，擅长为章节写出吸引人的开头。
请根据章节大纲创作【本章的开头部分】，要求：
1. 只写开头的第一个自然段或前几句，不要写完整章节
2. 内容要有画面感和情绪张力，抓住读者
3. 可以点出本章的矛盾或悬念，但不要完全展开
4. 语言风格与前文保持一致
5. 只输出小说正文内容，不要章节标题和其他说明
6. 字数控制在约${OPENING_WORDS_PER_CHAPTER}字左右（可以略多或略少）`

  const userPrompt = `小说：${title}
${genreText}${contextText}${charactersText}${previousText}

章节：${plan.title}
大纲：${plan.outline}

请创作本章开头：`

  return await callAliyunAIWithRetry([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], 3, 3000)
}

// 生成整章正文（约800-1500字）
async function generateFullChapter(
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
  const charactersText = context.characters.length > 0
    ? `已出现角色：${context.characters.join('、')}`
    : ''
  const previousText = previousContent
    ? `前一章结尾：\n${previousContent.slice(-500)}`
    : ''

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
4. 场景描写要有画面感
5. 文末要有适当的悬念或过渡，为下一章铺垫
6. 只输出小说正文内容，不要章节标题和其他说明
7. 字数控制在800-1500字左右`

  const userPrompt = `故事背景：
${storyContext}

本章信息：
章节标题：${plan.title}
章节大纲：${plan.outline}

请创作本章内容：`

  return await callAliyunAIWithRetry([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], 3, 4000)
}

// 生成摘要
async function generateSummary(content: string): Promise<string> {
  const prompt = `为以下内容生成摘要（50字内，包含主要事件）：

${content.slice(0, 1000)}

只输出摘要`

  return await callAliyunAIWithRetry([{ role: 'user', content: prompt }], 2, 2000, { maxTokens: 150 })
}

// 主流程
export async function POST(request: NextRequest) {
  const body = await request.json()
  
  const validation = requestSchema.safeParse(body)
  if (!validation.success) {
    return new Response(JSON.stringify({ error: validation.error.issues[0]?.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  const { novelId, title, description, genre, totalWords, chapterCount, generateMode } = validation.data
  const genreNormalized: string | null = genre ?? null
  
  // 计算每章目标字数（用于大纲生成时的上下文参考）
  const wordsPerChapter = Math.floor(totalWords / chapterCount)
  
  const stream = new ReadableStream({
    async start(controller) {
      const context: StoryContext = { characters: [], recentSummaries: [] }
      let previousContent = ''
      let totalGeneratedWords = 0
      const generatedChapters: Array<{ id: string; title: string; wordCount: number }> = []
      
      // 读取 OSS 已有章节索引，用于跳过已存在 order
      const ossMeta = await getNovelMetaFromOSS(novelId)
      const existingChapters = [...(ossMeta?.chapters ?? [])].sort((a, b) => a.order - b.order)
      const existingOrders = new Set(existingChapters.map((ch) => ch.order))
      
      // 如果所有章节都已存在，直接返回
      if (existingOrders.size >= chapterCount) {
        sendEvent(controller, 'complete', {
          message: `所有章节已存在，跳过生成。共 ${existingChapters.length} 章`,
          totalChapters: existingChapters.length,
          totalWords: existingChapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0),
          skipped: true,
          chapters: existingChapters.map((ch) => ({ id: ch.id, title: ch.title, wordCount: ch.wordCount }))
        })
        controller.close()
        return
      }
      
      // 发送跳过信息
      sendEvent(controller, 'existing', {
        message: `检测到已有 ${existingOrders.size} 章，将跳过这些章节`,
        existingCount: existingOrders.size,
        toGenerateCount: chapterCount - existingOrders.size
      })
      
      try {
        sendEvent(controller, 'start', { 
          message: '开始生成故事结构...',
          totalChapters: chapterCount 
        })
        
        const structure = await generateStoryStructure(title, description, genreNormalized, totalWords, chapterCount)
        sendEvent(controller, 'structure', { 
          message: '故事结构生成完成',
          beginning: structure.beginning,
          middle: structure.middle,
          ending: structure.ending
        })
        
        const batches = Math.ceil(chapterCount / BATCH_SIZE)
        
        for (let batch = 0; batch < batches; batch++) {
          const startIndex = batch * BATCH_SIZE
          const batchSize = Math.min(BATCH_SIZE, chapterCount - startIndex)
          
          sendEvent(controller, 'batch_start', {
            batch: batch + 1,
            totalBatches: batches,
            message: `开始生成第 ${startIndex + 1}-${startIndex + batchSize} 章大纲...`
          })
          
          const plans = await generateBatchOutlines(
            title, genreNormalized, structure, startIndex, batchSize, chapterCount, wordsPerChapter, context
          )
          
          sendEvent(controller, 'outlines', {
            message: `第 ${startIndex + 1}-${startIndex + batchSize} 章大纲生成完成`,
            chapters: plans.map(p => ({ index: p.index, title: p.title, outline: p.outline }))
          })
          
          for (const plan of plans) {
            // 跳过已存在的章节
            if (existingOrders.has(plan.index)) {
              sendEvent(controller, 'chapter_skip', {
                index: plan.index,
                title: plan.title,
                message: `第 ${plan.index + 1} 章已存在，跳过`
              })
              continue
            }
            
            sendEvent(controller, 'chapter_start', {
              index: plan.index,
              title: plan.title,
              message: `正在生成第 ${plan.index + 1} 章${generateMode === 'full' ? '正文' : '开头'}: ${plan.title}...`
            })
            
            const content = generateMode === 'full'
              ? await generateFullChapter(title, genreNormalized, plan, structure, context, previousContent)
              : await generateChapterOpening(title, genreNormalized, plan, context, previousContent)
            const summary = await generateSummary(content)
            
            context.recentSummaries.push(summary)
            if (context.recentSummaries.length > 5) context.recentSummaries.shift()
            
            const chapterId = randomUUID()
            try {
              await saveChapterContent(novelId, chapterId, content)
              await updateChapterInIndex(novelId, chapterId, {
                title: plan.title,
                chapterNumber: plan.index + 1,
                wordCount: content.length,
                order: plan.index,
                isPublished: false,
              })
            } catch (e) {
              console.error('OSS 写入失败:', e)
            }

            generatedChapters.push({ id: chapterId, title: plan.title, wordCount: content.length })
            totalGeneratedWords += content.length
            previousContent = content
            
            sendEvent(controller, 'chapter_done', {
              index: plan.index,
              title: plan.title,
              wordCount: content.length,
              totalWords: totalGeneratedWords,
              progress: ((plan.index + 1) / chapterCount * 100).toFixed(1),
              summary
            })
            
            await new Promise(r => setTimeout(r, 800))
          }
          
          if (batch < batches - 1) {
            await new Promise(r => setTimeout(r, 1500))
          }
        }
        
        const novelWordCount = await recomputeNovelWordCountFromOss(novelId)
        
        sendEvent(controller, 'complete', {
          message: `生成完成！新生成 ${generatedChapters.length} 章，共 ${totalGeneratedWords} 字`,
          totalChapters: chapterCount,
          generatedCount: generatedChapters.length,
          skippedCount: existingOrders.size,
          totalWords: novelWordCount,
          chapters: generatedChapters
        })
        
      } catch (error) {
        console.error('Generation error:', error)
        sendEvent(controller, 'error', {
          error: error instanceof Error ? error.message : '生成失败'
        })
      } finally {
        controller.close()
      }
    }
  })
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  })
}
