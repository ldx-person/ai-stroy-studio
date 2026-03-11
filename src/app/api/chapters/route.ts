import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createChapterSchema, updateChapterSchema, validateOrError } from '@/lib/validations/novel'
import { 
  uploadChapterContent, 
  downloadChapterContent, 
  deleteChapterContent,
  isOSSAvailable 
} from '@/lib/oss'

// 内容长度阈值，超过此长度则存储到OSS
const OSS_THRESHOLD = 500

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
        content: '', // 先创建空内容
        wordCount
      }
    })
    
    // 如果内容超过阈值且OSS可用，上传到OSS
    let contentOss: string | null = null
    if (chapterContent && isOSSAvailable()) {
      try {
        contentOss = await uploadChapterContent(novelId, chapter.id, chapterContent)
        // 更新章节记录
        await db.chapter.update({
          where: { id: chapter.id },
          data: { contentOss }
        })
        chapter.contentOss = contentOss
      } catch (ossError) {
        console.error('OSS upload failed, falling back to database storage:', ossError)
        // OSS上传失败，回退到数据库存储
        await db.chapter.update({
          where: { id: chapter.id },
          data: { content: chapterContent }
        })
        chapter.content = chapterContent
      }
    } else if (chapterContent) {
      // OSS不可用或内容较短，直接存数据库
      await db.chapter.update({
        where: { id: chapter.id },
        data: { content: chapterContent }
      })
      chapter.content = chapterContent
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
      select: { novelId: true, contentOss: true }
    })
    
    if (!existingChapter) {
      return NextResponse.json({ success: false, error: 'Chapter not found' }, { status: 404 })
    }
    
    const updateData: {
      title?: string
      content?: string
      contentOss?: string | null
      wordCount?: number
    } = {}
    
    if (title !== undefined) updateData.title = title
    
    if (content !== undefined) {
      const newWordCount = content.length
      updateData.wordCount = newWordCount
      
      // 如果内容超过阈值且OSS可用，上传到OSS
      if (content && isOSSAvailable()) {
        try {
          const contentOss = await uploadChapterContent(existingChapter.novelId, id, content)
          updateData.contentOss = contentOss
          updateData.content = '' // 清空数据库中的内容
        } catch (ossError) {
          console.error('OSS upload failed, falling back to database storage:', ossError)
          updateData.content = content
          updateData.contentOss = null
        }
      } else {
        updateData.content = content
        updateData.contentOss = null
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
      select: { novelId: true, contentOss: true }
    })
    
    if (!chapter) {
      return NextResponse.json({ success: false, error: 'Chapter not found' }, { status: 404 })
    }
    
    const novelId = chapter.novelId
    
    // 删除OSS上的内容
    if (chapter.contentOss && isOSSAvailable()) {
      try {
        await deleteChapterContent(chapter.contentOss)
      } catch (ossError) {
        console.error('Failed to delete OSS content:', ossError)
        // 继续删除数据库记录
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

// GET - 获取章节内容（支持从OSS读取）
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
        contentOss: true,
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
    
    // 如果有OSS路径，从OSS读取内容
    let fullContent = chapter.content
    if (chapter.contentOss && isOSSAvailable()) {
      try {
        fullContent = await downloadChapterContent(chapter.contentOss)
      } catch (ossError) {
        console.error('Failed to download from OSS:', ossError)
        // 使用数据库中的内容
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
