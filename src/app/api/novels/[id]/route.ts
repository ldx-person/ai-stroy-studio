import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getNovelFromOSS, deleteNovelFromOSS, isOSSAvailable } from '@/lib/oss'

// GET - 获取单个小说详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    // 先尝试从本地数据库获取
    let novel = await db.novel.findUnique({
      where: { id },
      include: {
        chapters: {
          orderBy: {
            order: 'asc'
          }
        }
      }
    })
    
    // 如果本地没有，尝试从OSS获取
    if (!novel && isOSSAvailable()) {
      const ossNovel = await getNovelFromOSS(id)
      
      if (ossNovel) {
        // 同步到本地数据库
        novel = await db.novel.create({
          data: {
            id: ossNovel.meta.id,
            title: ossNovel.meta.title,
            description: ossNovel.description,
            genre: ossNovel.meta.genre,
            status: ossNovel.meta.status,
            wordCount: ossNovel.meta.wordCount,
            createdAt: new Date(ossNovel.meta.createdAt),
            updatedAt: new Date(ossNovel.meta.updatedAt)
          },
          include: {
            chapters: true
          }
        })
        
        // 创建章节
        for (const chapter of ossNovel.chapters) {
          await db.chapter.create({
            data: {
              id: chapter.id,
              novelId: id,
              title: chapter.title,
              content: chapter.content,
              wordCount: chapter.wordCount,
              order: chapter.order,
              isPublished: chapter.isPublished,
              createdAt: new Date(chapter.createdAt),
              updatedAt: new Date(chapter.updatedAt)
            }
          })
        }
        
        // 重新获取完整数据
        novel = await db.novel.findUnique({
          where: { id },
          include: {
            chapters: {
              orderBy: {
                order: 'asc'
              }
            }
          }
        })
      }
    }
    
    if (!novel) {
      return NextResponse.json({ success: false, error: 'Novel not found' }, { status: 404 })
    }
    
    // 如果有章节但内容为空，尝试从OSS读取
    if (isOSSAvailable() && novel.chapters.length > 0) {
      const chaptersWithContent = await Promise.all(
        novel.chapters.map(async (chapter) => {
          if (!chapter.content) {
            try {
              const { getChapterContent } = await import('@/lib/oss')
              const content = await getChapterContent(id, chapter.id)
              if (content) {
                // 更新数据库
                await db.chapter.update({
                  where: { id: chapter.id },
                  data: { content, wordCount: content.length }
                })
                return { ...chapter, content }
              }
            } catch (e) {
              console.error('读取章节内容失败:', e)
            }
          }
          return chapter
        })
      )
      
      return NextResponse.json({ 
        success: true, 
        novel: {
          ...novel,
          chapters: chaptersWithContent
        }
      })
    }
    
    return NextResponse.json({ success: true, novel })
  } catch (error) {
    console.error('Failed to fetch novel:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch novel' }, { status: 500 })
  }
}

// DELETE - 删除小说及其OSS文件
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    // 检查小说是否存在
    const novel = await db.novel.findUnique({
      where: { id },
      select: { id: true }
    })
    
    if (!novel) {
      return NextResponse.json({ success: false, error: 'Novel not found' }, { status: 404 })
    }
    
    // 删除OSS上的所有文件
    if (isOSSAvailable()) {
      try {
        await deleteNovelFromOSS(id)
      } catch (error) {
        console.error('Failed to delete OSS files:', error)
        // 继续删除数据库记录
      }
    }
    
    // 删除数据库记录（级联删除章节和角色）
    await db.novel.delete({
      where: { id }
    })
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete novel:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete novel' }, { status: 500 })
  }
}
