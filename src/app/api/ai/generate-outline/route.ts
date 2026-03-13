import { NextRequest, NextResponse } from 'next/server'
import { callAliyunAIWithRetry } from '@/lib/ai'
import { z } from 'zod'

// 章节大纲结构
interface ChapterOutline {
  index: number
  title: string
  outline: string
  estimatedWords: number
}

// AI generate outline schema
const outlineSchema = z.object({
  title: z.string().trim().min(1, '小说标题不能为空').max(100, '标题最多100个字符'),
  description: z.string().trim().min(20, '简介至少需要20个字符').max(2000, '简介最多2000个字符'),
  genre: z.string().max(50).optional().nullable(),
  totalWords: z.number().int().min(1000, '总字数至少1000字').max(1000000, '总字数最多100万字'),
  chapterCount: z.number().int().min(3, '章节数至少3章').max(500, '章节数最多500章')
})

// 每批生成的章节数
const BATCH_SIZE = 20

// Helper to validate
function validate(data: unknown): { success: true; data: z.infer<typeof outlineSchema> } | { success: false; error: string } {
  try {
    const result = outlineSchema.safeParse(data)
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
    
    const { title, description, genre, totalWords, chapterCount } = validation.data
    const avgWordsPerChapter = Math.floor(totalWords / chapterCount)
    
    const genreText = genre ? `这是一部${genre}类型的小说。` : ''
    
    // 计算阶段章节数
    const beginningChapters = Math.max(1, Math.floor(chapterCount * 0.15))
    const middleChapters = Math.floor(chapterCount * 0.7)
    const endingChapters = Math.max(1, chapterCount - beginningChapters - middleChapters)
    
    // Step 1: 生成故事结构
    const structurePrompt = `你是一位专业的小说策划师。

小说标题：${title}
小说简介：${description}
${genreText}
计划总字数：${totalWords}字
章节数量：${chapterCount}章

请按以下JSON格式输出故事结构：
{
  "beginning": "开头阶段概述（约100-200字），占前${beginningChapters}章。描述故事开端、主要人物登场、初始背景。",
  "middle": "经过阶段概述（约200-300字），占中间${middleChapters}章。描述故事发展、冲突、转折等核心情节。",
  "ending": "结尾阶段概述（约100-200字），占最后${endingChapters}章。描述高潮和结局。"
}

只输出JSON，不要其他内容。`
    
    const structureContent = await callAliyunAIWithRetry([
      { role: 'user', content: structurePrompt }
    ], 3, 3000)
    
    if (!structureContent) {
      return NextResponse.json({ success: false, error: '生成故事结构失败，请重试' }, { status: 500 })
    }
    
    let structure: { beginning: string; middle: string; ending: string }
    try {
      let jsonStr = structureContent.trim()
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7)
      else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3)
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3)
      jsonStr = jsonStr.trim()
      structure = JSON.parse(jsonStr)
      
      if (!structure.beginning || !structure.middle || !structure.ending) {
        throw new Error('Invalid structure')
      }
    } catch {
      return NextResponse.json({ success: false, error: '故事结构解析失败，请重试' }, { status: 500 })
    }
    
    // Step 2: 分批生成章节大纲
    const allChapters: ChapterOutline[] = []
    const batches = Math.ceil(chapterCount / BATCH_SIZE)
    
    const beginningEnd = beginningChapters
    const middleEnd = beginningChapters + middleChapters
    
    for (let batch = 0; batch < batches; batch++) {
      const startIndex = batch * BATCH_SIZE
      const endIndex = Math.min(startIndex + BATCH_SIZE, chapterCount)
      const batchChapterCount = endIndex - startIndex
      
      // 确定阶段
      let phaseInfo = ''
      let phaseHint = ''
      
      if (endIndex <= beginningEnd) {
        phaseInfo = `【开头阶段】${structure.beginning}`
        phaseHint = '这是故事的开头部分，要介绍人物、背景，埋下伏笔。'
      } else if (startIndex >= middleEnd) {
        phaseInfo = `【结尾阶段】${structure.ending}`
        phaseHint = '这是故事的结尾部分，要推向高潮并圆满收尾。'
      } else if (startIndex < beginningEnd && endIndex > beginningEnd) {
        phaseInfo = `【开头过渡到经过】
开头：${structure.beginning}
经过：${structure.middle}`
        phaseHint = '这是从开头到经过的过渡部分，要让故事节奏逐渐加快。'
      } else if (startIndex < middleEnd && endIndex > middleEnd) {
        phaseInfo = `【经过过渡到结尾】
经过：${structure.middle}
结尾：${structure.ending}`
        phaseHint = '这是从经过到结尾的过渡部分，要将故事推向高潮。'
      } else {
        phaseInfo = `【经过阶段】${structure.middle}`
        phaseHint = '这是故事的主体部分，要有冲突、转折、成长。'
      }
      
      const chapterPrompt = `你是小说策划师，为以下小说生成章节大纲：

小说：${title}
${genreText}
总章节：${chapterCount}章，当前是第${startIndex + 1}-${endIndex}章
每章约${avgWordsPerChapter}字

${phaseInfo}

${phaseHint}

请生成${batchChapterCount}个章节的大纲，JSON格式：
{
  "chapters": [
    {
      "title": "第X章 标题",
      "outline": "本章情节概述（40-60字）"
    }
  ]
}

要求：
1. 标题要吸引人，符合小说风格
2. 大纲要有具体情节，不要太笼统
3. 章节之间要有连贯性
4. 只输出JSON，不要其他内容`
      
      // 增加批次间延迟，避免速率限制
      if (batch > 0) {
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
      
      const chapterContent = await callAliyunAIWithRetry([
        { role: 'user', content: chapterPrompt }
      ], 3, 4000)
      
      if (!chapterContent) {
        console.error(`Batch ${batch} failed, using fallback`)
        for (let i = 0; i < batchChapterCount; i++) {
          const idx = allChapters.length
          allChapters.push({
            index: idx,
            title: `第${idx + 1}章 待续`,
            outline: `故事继续发展。`,
            estimatedWords: avgWordsPerChapter
          })
        }
        continue
      }
      
      try {
        let jsonStr = chapterContent.trim()
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7)
        else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3)
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3)
        jsonStr = jsonStr.trim()
        
        const batchData = JSON.parse(jsonStr)
        
        if (Array.isArray(batchData.chapters)) {
          for (const ch of batchData.chapters) {
            if (allChapters.length >= chapterCount) break
            allChapters.push({
              index: allChapters.length,
              title: ch.title || `第${allChapters.length + 1}章`,
              outline: ch.outline || '故事继续发展。',
              estimatedWords: avgWordsPerChapter
            })
          }
        }
      } catch (parseError) {
        console.error(`Batch ${batch} parse failed:`, parseError)
        for (let i = 0; i < batchChapterCount; i++) {
          if (allChapters.length >= chapterCount) break
          const idx = allChapters.length
          allChapters.push({
            index: idx,
            title: `第${idx + 1}章 待续`,
            outline: `故事继续发展。`,
            estimatedWords: avgWordsPerChapter
          })
        }
      }
    }
    
    // 确保章节数量正确
    while (allChapters.length < chapterCount) {
      const idx = allChapters.length
      allChapters.push({
        index: idx,
        title: `第${idx + 1}章 待续`,
        outline: `故事继续发展。`,
        estimatedWords: avgWordsPerChapter
      })
    }
    
    return NextResponse.json({ 
      success: true, 
      outline: {
        beginning: structure.beginning,
        middle: structure.middle,
        ending: structure.ending,
        chapters: allChapters.slice(0, chapterCount),
        totalWords,
        chapterCount: allChapters.length
      }
    })
  } catch (error) {
    console.error('Generate outline error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : '生成大纲失败' 
    }, { status: 500 })
  }
}
