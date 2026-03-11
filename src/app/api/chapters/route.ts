import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createChapterSchema, updateChapterSchema, validateOrError } from '@/lib/validations/novel'

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
    
    // Validate input
    const validation = validateOrError(createChapterSchema, body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    
    const { novelId, title, order, content } = validation.data
    
    const chapter = await db.chapter.create({
      data: {
        novelId,
        title,
        order: order || 0,
        content: content || '',
        wordCount: content?.length || 0
      }
    })
    
    // Update novel word count
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
    
    // Validate input
    const validation = validateOrError(updateChapterSchema, body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    
    const { id, title, content, wordCount } = validation.data
    
    // Get chapter to find novelId
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
      updateData.content = content
      updateData.wordCount = content.length
    }
    if (wordCount !== undefined) updateData.wordCount = wordCount
    
    const chapter = await db.chapter.update({
      where: { id },
      data: updateData
    })
    
    // Update novel word count if content changed
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
    
    // Get chapter to find novelId before deletion
    const chapter = await db.chapter.findUnique({
      where: { id },
      select: { novelId: true }
    })
    
    if (!chapter) {
      return NextResponse.json({ success: false, error: 'Chapter not found' }, { status: 404 })
    }
    
    const novelId = chapter.novelId
    
    await db.chapter.delete({
      where: { id }
    })
    
    // Update novel word count after deletion
    await updateNovelWordCount(novelId)
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete chapter:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete chapter' }, { status: 500 })
  }
}
