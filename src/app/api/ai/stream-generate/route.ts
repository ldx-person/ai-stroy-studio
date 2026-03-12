import { NextRequest } from 'next/server'
import { callAliyunAIWithRetry } from '@/lib/aliyun-ai'
import { db } from '@/lib/db'
import { saveChapterContent, updateChapterInIndex, updateNovelMeta } from '@/lib/oss'
import { z } from 'zod'

// 请求验证
const requestSchema = z.object({
  novelId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(20),
  genre: z.string().optional().nullable(),
  totalWords: z.number().int().min(1000).max(1000000),
  chapterCount: z.number().int().min(3).max(500)
})

// 配置
const BATCH_SIZE = 3
const WORDS_PER_CHAPTER_MIN = 1500
const WORDS_PER_CHAPTER_MAX = 8000

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

// 生成章节内容
async function generateChapterContent(
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
  
  const systemPrompt = `你是专业小说作家。根据大纲创作内容，要求：
1. 内容丰富生动，有细节和情感
2. 对话自然，符合角色性格
3. 场景有画面感
4. 结尾有悬念铺垫下章
5. 只输出正文，无标题说明
6. 字数${plan.estimatedWords - 200}-${plan.estimatedWords + 500}字`

  const userPrompt = `小说：${title}
${genreText}${contextText}${charactersText}${previousText}

章节：${plan.title}
大纲：${plan.outline}

创作内容：`

  return await callAliyunAIWithRetry([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], 3, 3000)
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
  
  const { novelId, title, description, genre, totalWords, chapterCount } = validation.data
  
  let wordsPerChapter = Math.floor(totalWords / chapterCount)
  wordsPerChapter = Math.max(WORDS_PER_CHAPTER_MIN, Math.min(WORDS_PER_CHAPTER_MAX, wordsPerChapter))
  
  const stream = new ReadableStream({
    async start(controller) {
      const context: StoryContext = { characters: [], recentSummaries: [] }
      let previousContent = ''
      let totalGeneratedWords = 0
      const generatedChapters: Array<{ id: string; title: string; wordCount: number }> = []
      
      try {
        sendEvent(controller, 'start', { 
          message: '开始生成故事结构...',
          totalChapters: chapterCount 
        })
        
        const structure = await generateStoryStructure(title, description, genre, totalWords, chapterCount)
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
            title, genre, structure, startIndex, batchSize, chapterCount, wordsPerChapter, context
          )
          
          sendEvent(controller, 'outlines', {
            message: `第 ${startIndex + 1}-${startIndex + batchSize} 章大纲生成完成`,
            chapters: plans.map(p => ({ index: p.index, title: p.title, outline: p.outline }))
          })
          
          for (const plan of plans) {
            sendEvent(controller, 'chapter_start', {
              index: plan.index,
              title: plan.title,
              message: `正在生成第 ${plan.index + 1} 章: ${plan.title}...`
            })
            
            const content = await generateChapterContent(title, genre, plan, context, previousContent)
            const summary = await generateSummary(content)
            
            context.recentSummaries.push(summary)
            if (context.recentSummaries.length > 5) context.recentSummaries.shift()
            
            const chapter = await db.chapter.create({
              data: { novelId, title: plan.title, content, wordCount: content.length, order: plan.index }
            })
            
            try {
              await saveChapterContent(novelId, chapter.id, content)
              await updateChapterInIndex(novelId, chapter.id, {
                title: plan.title, wordCount: content.length, order: plan.index
              })
            } catch (e) {
              console.error('OSS同步失败:', e)
            }
            
            generatedChapters.push({ id: chapter.id, title: plan.title, wordCount: content.length })
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
        
        await db.novel.update({ where: { id: novelId }, data: { wordCount: totalGeneratedWords } })
        await updateNovelMeta(novelId, { wordCount: totalGeneratedWords })
        
        sendEvent(controller, 'complete', {
          message: `生成完成！共 ${chapterCount} 章，${totalGeneratedWords} 字`,
          totalChapters: chapterCount,
          totalWords: totalGeneratedWords,
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
