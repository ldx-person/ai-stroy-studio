import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createChapterSchema, updateChapterSchema, validateOrError } from '@/lib/validations/novel'
import { 
  saveChapterContent,
  getChapterContent,
  updateChapterInIndex,
  removeChapterFromIndex,
  isOSSAvailable 
} from '@/lib/oss'

// Helper function to update novel word count
async function updateNovelWordCount(novelId: string) {
  const chapters = await db.chapter.findMany({
    where: { novelId },
    select: { wordCount: true }
  })
  
  const totalWordCount = chapters.reduce((sum, ch) => sum + ch.wordCount, 0)
  
  await db.novel.update({
    where: { id: novelId },
    data: { wordCount: totalWordCount }
  })
  
  // 同步到OSS
  if (isOSSAvailable()) {
    try {
      const { updateNovelMeta } = await import('@/lib/oss')
      await updateNovelMeta(novelId, { wordCount: totalWordCount })
    } catch (e) {
      console.error('更新OSS字数失败:', e)
    }
  }
}

// POST - 创建新章节
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const validation = validateOrError(createChapterSchema, body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    
    const { novelId, title, order, content } = validation.data
    const chapterContent = content || ''
    const wordCount = chapterContent.length
    
    // 创建章节
    const chapter = await db.chapter.create({
      data: {
        novelId,
        title,
        order: order || 0,
        content: chapterContent,
        wordCount
      }
    })
    
    // 同步到OSS
    if (isOSSAvailable()) {
      try {
        // 保存章节内容
        await saveChapterContent(novelId, chapter.id, chapterContent)
        // 更新章节索引
        await updateChapterInIndex(novelId, chapter.id, {
          title: chapter.title,
          wordCount: chapter.wordCount,
          order: chapter.order,
          isPublished: chapter.isPublished
        })
      } catch (ossError) {
        console.error('同步章节到OSS失败:', ossError)
      }
    }
    
    // 更新小说字数
    await updateNovelWordCount(novelId)
    
    return NextResponse.json({ success: true, chapter })
  } catch (error) {
    console.error('Failed to create chapter:', error)
    return NextResponse.json({ success: false, error: 'Failed to create chapter' }, { status: 500 })
  }
}

// PUT - 更新章节
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    
    const validation = validateOrError(updateChapterSchema, body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    
    const { id, title, content, wordCount } = validation.data
    
    const existingChapter = await db.chapter.findUnique({
      where: { id },
      select: { novelId: true }
    })
    
    if (!existingChapter) {
      return NextResponse.json({ success: false, error: 'Chapter not found' }, { status: 404 })
    }
    
    const updateData: {
      title?: string
      content?: string
      wordCount?: number
    } = {}
    
    if (title !== undefined) updateData.title = title
    
    if (content !== undefined) {
      const newWordCount = content.length
      updateData.wordCount = newWordCount
      updateData.content = content
      
      // 同步到OSS
      if (isOSSAvailable()) {
        try {
          await saveChapterContent(existingChapter.novelId, id, content)
          await updateChapterInIndex(existingChapter.novelId, id, {
            title: title,
            wordCount: newWordCount
          })
        } catch (ossError) {
          console.error('同步章节到OSS失败:', ossError)
        }
      }
    } else if (wordCount !== undefined) {
      updateData.wordCount = wordCount
    }
    
    const chapter = await db.chapter.update({
      where: { id },
      data: updateData
    })
    
    // 更新小说字数
    if (content !== undefined) {
      await updateNovelWordCount(existingChapter.novelId)
    }
    
    return NextResponse.json({ success: true, chapter })
  } catch (error) {
    console.error('Failed to update chapter:', error)
    return NextResponse.json({ success: false, error: 'Failed to update chapter' }, { status: 500 })
  }
}

// DELETE - 删除章节
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'Chapter ID is required' }, { status: 400 })
    }
    
    const chapter = await db.chapter.findUnique({
      where: { id },
      select: { novelId: true }
    })
    
    if (!chapter) {
      return NextResponse.json({ success: false, error: 'Chapter not found' }, { status: 404 })
    }
    
    const novelId = chapter.novelId
    
    // 删除OSS上的内容
    if (isOSSAvailable()) {
      try {
        await removeChapterFromIndex(novelId, id)
      } catch (ossError) {
        console.error('删除OSS章节失败:', ossError)
      }
    }
    
    await db.chapter.delete({
      where: { id }
    })
    
    // 更新小说字数
    await updateNovelWordCount(novelId)
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete chapter:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete chapter' }, { status: 500 })
  }
}

// GET - 获取章节内容
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'Chapter ID is required' }, { status: 400 })
    }
    
    const chapter = await db.chapter.findUnique({
      where: { id },
      select: {
        id: true,
        novelId: true,
        title: true,
        content: true,
        wordCount: true,
        order: true,
        isPublished: true,
        createdAt: true,
        updatedAt: true
      }
    })
    
    if (!chapter) {
      return NextResponse.json({ success: false, error: 'Chapter not found' }, { status: 404 })
    }
    
    // 如果数据库内容为空，尝试从OSS读取
    let fullContent = chapter.content
    if (!fullContent && isOSSAvailable()) {
      try {
        fullContent = await getChapterContent(chapter.novelId, id)
        if (fullContent) {
          // 更新数据库
          await db.chapter.update({
            where: { id },
            data: { content: fullContent, wordCount: fullContent.length }
          })
        }
      } catch (ossError) {
        console.error('从OSS读取章节失败:', ossError)
      }
    }
    
    return NextResponse.json({ 
      success: true, 
      chapter: {
        ...chapter,
        content: fullContent
      }
    })
  } catch (error) {
    console.error('Failed to get chapter:', error)
    return NextResponse.json({ success: false, error: 'Failed to get chapter' }, { status: 500 })
  }
}
