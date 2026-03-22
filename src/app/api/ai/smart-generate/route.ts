import { NextRequest, NextResponse } from 'next/server'
import { callAliyunAIWithRetry } from '@/lib/aliyun-ai'
import { randomUUID } from 'crypto'
import { getNovelMetaFromOSS, getChapterContent, saveChapterContent, updateChapterInIndex } from '@/lib/oss'
import { recomputeNovelWordCountFromOss } from '@/lib/novel-oss-helpers'
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

// 生成批次大小（一次生成少量章节，避免请求过长）
const BATCH_SIZE = 3
// 智能章节生成功能这里的目标是「给出每章的开头」，而不是整章全文
// 因此只需要一个相对较短的篇幅
const OPENING_WORDS_PER_CHAPTER = 100

// 阶段划分比例
const PHASE_RATIOS = {
  beginning: 0.15,  // 开头15%
  middle: 0.70,     // 经过70%
  ending: 0.15      // 结尾15%
}

interface ChapterPlan {
  index: number
  phase: 'beginning' | 'middle' | 'ending'
  title: string
  outline: string
  estimatedWords: number
}

interface StoryContext {
  summary: string  // 故事整体摘要
  characters: string[]  // 已出现的角色
  currentPlot: string  // 当前情节发展
  recentSummaries: string[]  // 最近章节摘要
}

/**
 * 生成故事结构（开头/经过/结尾概述）
 */
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

请为这个故事创作三个阶段的故事发展概述：

1. 开头阶段（约${Math.floor(chapterCount * PHASE_RATIOS.beginning)}章）：
   - 主要人物的登场和背景介绍
   - 故事的起点和初始冲突
   - 吸引读者的关键事件

2. 经过阶段（约${Math.floor(chapterCount * PHASE_RATIOS.middle)}章）：
   - 故事的主要发展和转折
   - 角色成长和关系变化
   - 核心冲突的展开

3. 结尾阶段（约${Math.floor(chapterCount * PHASE_RATIOS.ending)}章）：
   - 高潮事件和最终对决
   - 悬念的解答和收尾
   - 结局和后续展望

请按以下JSON格式输出：
{
  "beginning": "开头阶段概述（100-150字）",
  "middle": "经过阶段概述（200-300字）",
  "ending": "结尾阶段概述（100-150字）"
}

只输出JSON，不要其他内容。`

  const content = await callAliyunAIWithRetry([
    { role: 'user', content: prompt }
  ], 3, 3000)

  let jsonStr = content.trim()
  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7)
  else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3)
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3)
  
  return JSON.parse(jsonStr.trim())
}

/**
 * 生成分批章节大纲
 */
async function generateBatchOutlines(
  title: string,
  description: string,
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
  
  // 确定阶段
  const beginningEnd = Math.floor(totalChapters * PHASE_RATIOS.beginning)
  const middleEnd = Math.floor(totalChapters * (PHASE_RATIOS.beginning + PHASE_RATIOS.middle))
  
  let phaseInfo = ''
  let phaseHint = ''
  
  if (endIndex <= beginningEnd) {
    phaseInfo = `【开头阶段】${structure.beginning}`
    phaseHint = '这是故事的开头部分，要介绍人物、背景，埋下伏笔，吸引读者。'
  } else if (startIndex >= middleEnd) {
    phaseInfo = `【结尾阶段】${structure.ending}`
    phaseHint = '这是故事的结尾部分，要推向高潮并圆满收尾，给读者满足感。'
  } else if (startIndex < beginningEnd && endIndex > beginningEnd) {
    phaseInfo = `【开头过渡到经过】
开头：${structure.beginning}
经过：${structure.middle}`
    phaseHint = '这是从开头到经过的过渡部分，要让故事节奏逐渐加快，冲突逐渐升级。'
  } else if (startIndex < middleEnd && endIndex > middleEnd) {
    phaseInfo = `【经过过渡到结尾】
经过：${structure.middle}
结尾：${structure.ending}`
    phaseHint = '这是从经过到结尾的过渡部分，要将故事推向高潮，为结局做准备。'
  } else {
    phaseInfo = `【经过阶段】${structure.middle}`
    phaseHint = '这是故事的主体部分，要有冲突、转折、成长，保持读者的兴趣。'
  }
  
  const contextText = context.recentSummaries.length > 0
    ? `\n\n之前的剧情摘要：
${context.recentSummaries.map((s, i) => `第${startIndex - context.recentSummaries.length + i + 1}章摘要：${s}`).join('\n')}`
    : ''
  
  const charactersText = context.characters.length > 0
    ? `\n\n已出现的角色：${context.characters.join('、')}`
    : ''
  
  const genreText = genre ? `这是一部${genre}类型的小说。` : ''
  
  const prompt = `你是小说策划师，为以下小说生成章节大纲：

小说：${title}
${genreText}
总章节：${totalChapters}章，当前生成第${startIndex + 1}-${endIndex}章
每章约${wordsPerChapter}字

${phaseInfo}

${phaseHint}${contextText}${charactersText}

请生成${actualBatchSize}个章节的大纲，JSON格式：
{
  "chapters": [
    {
      "title": "第X章 标题（标题要吸引人，4-10个字）",
      "outline": "本章情节概述（50-80字，要具体有细节）",
      "keyEvents": ["关键事件1", "关键事件2"]
    }
  ]
}

要求：
1. 标题要吸引人，符合小说风格
2. 大纲要具体有细节，不要太笼统
3. 章节之间要有连贯性，承上启下
4. 要有情节推进和冲突发展
5. 只输出JSON`

  const content = await callAliyunAIWithRetry([
    { role: 'user', content: prompt }
  ], 3, 4000)

  let jsonStr = content.trim()
  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7)
  else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3)
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3)
  
  const data = JSON.parse(jsonStr.trim())
  
  // 确定每章的阶段
  const getPhase = (index: number): 'beginning' | 'middle' | 'ending' => {
    if (index < beginningEnd) return 'beginning'
    if (index < middleEnd) return 'middle'
    return 'ending'
  }
  
  return data.chapters.map((ch: { title: string; outline: string; keyEvents?: string[] }, i: number) => ({
    index: startIndex + i,
    phase: getPhase(startIndex + i),
    title: ch.title,
    outline: ch.outline,
    estimatedWords: wordsPerChapter
  }))
}

/**
 * 生成章节开头内容（约100字），用于给出大概方向，不是整章全文
 */
async function generateChapterContent(
  title: string,
  genre: string | null,
  chapterPlan: ChapterPlan,
  context: StoryContext,
  previousContent: string
): Promise<string> {
  const genreText = genre ? `这是一部${genre}类型的小说。` : ''
  
  const contextText = context.recentSummaries.length > 0
    ? `\n之前的剧情：${context.recentSummaries.slice(-3).join(' -> ')}`
    : ''
  
  const charactersText = context.characters.length > 0
    ? `\n已出现的角色：${context.characters.join('、')}`
    : ''
  
  const previousText = previousContent
    ? `\n前一章结尾（用于衔接）：
"${previousContent.slice(-300)}"`
    : ''
  
  const systemPrompt = `你是一位专业的小说作家，擅长为章节写出吸引人的开头。
请根据章节大纲创作【本章的开头部分】，要求：
1. 只写开头的第一个自然段或前几句，不要写完整章节
2. 内容要有画面感和情绪张力，抓住读者
3. 可以点出本章的矛盾或悬念，但不要完全展开
4. 语言风格与前文保持一致
5. 只输出小说正文内容，不要章节标题和其他说明
6. 字数控制在约${OPENING_WORDS_PER_CHAPTER}字左右（可以略多或略少）`

  const userPrompt = `小说标题：${title}
${genreText}
${contextText}${charactersText}${previousText}

本章信息：
章节：${chapterPlan.title}
阶段：${chapterPlan.phase === 'beginning' ? '开头' : chapterPlan.phase === 'middle' ? '经过' : '结尾'}
大纲：${chapterPlan.outline}

请创作本章内容：`

  return await callAliyunAIWithRetry([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], 3, 3000)
}

/**
 * 生成章节摘要
 */
async function generateChapterSummary(
  title: string,
  chapterTitle: string,
  content: string
): Promise<string> {
  const prompt = `请为以下小说章节生成一个简洁的摘要（50-80字），包含主要事件和情节发展：

小说标题：${title}
章节标题：${chapterTitle}
章节内容：
${content.slice(0, 1500)}...

只输出摘要内容，不要其他说明。`

  return await callAliyunAIWithRetry([
    { role: 'user', content: prompt }
  ], 2, 2000, { maxTokens: 200 })
}

/**
 * 提取章节中的角色
 */
async function extractCharacters(content: string, existingCharacters: string[]): Promise<string[]> {
  const prompt = `从以下小说内容中提取出现的主要角色名字（只输出角色名，用逗号分隔）：

${content.slice(0, 1000)}

已有的角色：${existingCharacters.join('、') || '无'}

只输出新出现的角色名字（如果没有新角色，输出"无"）`

  const result = await callAliyunAIWithRetry([
    { role: 'user', content: prompt }
  ], 2, 2000, { maxTokens: 100 })
  
  if (result === '无' || !result.trim()) {
    return existingCharacters
  }
  
  const newCharacters = result.split(/[,，、\s]+/).filter(c => c.trim() && c.length <= 10)
  return [...new Set([...existingCharacters, ...newCharacters])]
}

/**
 * 主生成流程
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const validation = requestSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json({ 
        success: false, 
        error: validation.error.issues[0]?.message || '参数验证失败' 
      }, { status: 400 })
    }
    
    const { novelId, title, description, genre, totalWords, chapterCount } = validation.data
    const genreNormalized: string | null = genre ?? null
    
    // 计算每章字数（这里只是用来控制大纲粒度，实际内容只生成开头）
    const wordsPerChapter = Math.max(
      OPENING_WORDS_PER_CHAPTER,
      Math.floor(totalWords / chapterCount)
    )
    
    const ossMeta = await getNovelMetaFromOSS(novelId)
    const existingChapters = [...(ossMeta?.chapters ?? [])].sort((a, b) => a.order - b.order)
    const existingCount = existingChapters.length

    let previousContent = ''
    if (existingCount > 0) {
      const last = existingChapters[existingCount - 1]
      previousContent = await getChapterContent(novelId, last.id)
    }

    const context: StoryContext = {
      summary: description,
      characters: [],
      currentPlot: existingCount > 0 ? existingChapters[existingCount - 1].title : '',
      recentSummaries: [],
    }

    const results: Array<{
      index: number
      title: string
      content: string
      wordCount: number
      summary: string
    }> = []

    let totalGeneratedWords = existingChapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0)
    
    // Step 1: 生成故事结构
    console.log('生成故事结构...')
    const structure = await generateStoryStructure(title, description, genreNormalized, totalWords, chapterCount)
    
    // Step 2: 分批生成章节
    const startIndex = existingCount
    if (startIndex >= chapterCount) {
      return NextResponse.json({
        success: true,
        message: '已有章节数量已达到或超过目标章节数，未生成新的章节开头',
        totalChapters: existingCount,
        totalWords: totalGeneratedWords,
        chapters: existingChapters.map((ch) => ({
          index: ch.order,
          title: ch.title,
          wordCount: ch.wordCount,
        }))
      })
    }
    
    const remainingChapters = chapterCount - startIndex
    const batches = Math.ceil(remainingChapters / BATCH_SIZE)
    
    for (let batch = 0; batch < batches; batch++) {
      const batchStartIndex = startIndex + batch * BATCH_SIZE
      const batchSize = Math.min(BATCH_SIZE, chapterCount - batchStartIndex)
      
      console.log(`生成第 ${batch + 1}/${batches} 批章节大纲 (${batchStartIndex + 1}-${batchStartIndex + batchSize})...`)
      
      // 生成这批章节的大纲
      const chapterPlans = await generateBatchOutlines(
        title, description, genreNormalized, structure,
        batchStartIndex, batchSize, chapterCount, wordsPerChapter, context
      )
      
      // 逐章生成内容
      for (const plan of chapterPlans) {
        console.log(`生成第 ${plan.index + 1} 章: ${plan.title}`)
        
        // 生成章节内容
        const content = await generateChapterContent(
          title, genreNormalized, plan, context, previousContent
        )
        
        // 生成章节摘要
        const summary = await generateChapterSummary(title, plan.title, content)
        
        // 提取角色
        context.characters = await extractCharacters(content, context.characters)
        
        // 更新上下文
        context.recentSummaries.push(summary)
        if (context.recentSummaries.length > 5) {
          context.recentSummaries.shift()
        }
        context.currentPlot = summary
        
        // 保存结果
        results.push({
          index: plan.index,
          title: plan.title,
          content,
          wordCount: content.length,
          summary
        })
        
        totalGeneratedWords += content.length
        previousContent = content
        
        // 批次间延迟
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      
      // 批次间更长延迟
      if (batch < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
    
    // Step 3: 只为缺失的章节追加「章节开头」，不覆盖已有章节
    console.log('保存章节开头到数据库...')
    
    for (const result of results) {
      // 如果该 index 已经有章节，则跳过（不覆盖）
      const exists = existingChapters.find(ch => ch.order === result.index)
      if (exists) continue

      const chapterId = randomUUID()
      try {
        await saveChapterContent(novelId, chapterId, result.content)
        await updateChapterInIndex(novelId, chapterId, {
          title: result.title,
          chapterNumber: result.index + 1,
          wordCount: result.wordCount,
          order: result.index,
          isPublished: false,
        })
      } catch (ossError) {
        console.error('OSS 写入失败:', ossError)
      }
    }

    totalGeneratedWords = await recomputeNovelWordCountFromOss(novelId)
    
    return NextResponse.json({
      success: true,
      message: `成功生成 ${results.length} 章，共 ${totalGeneratedWords} 字`,
      totalChapters: results.length,
      totalWords: totalGeneratedWords,
      chapters: results.map(r => ({
        index: r.index,
        title: r.title,
        wordCount: r.wordCount
      }))
    })
    
  } catch (error) {
    console.error('Smart generate error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : '生成失败' 
    }, { status: 500 })
  }
}
