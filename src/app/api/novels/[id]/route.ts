import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { downloadChapterContent, deleteNovelFiles, isOSSAvailable } from '@/lib/oss'

// GET - 获取单个小说详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    const novel = await db.novel.findUnique({
      where: { id },
      include: {
        chapters: {
          orderBy: {
            order: 'asc'
          }
        }
      }
    })
    
    if (!novel) {
      return NextResponse.json({ success: false, error: 'Novel not found' }, { status: 404 })
    }
    
    // 如果OSS可用，从OSS读取章节内容
    if (isOSSAvailable()) {
      const chaptersWithContent = await Promise.all(
        novel.chapters.map(async (chapter) => {
          let content = chapter.content
          
          if (chapter.contentOss) {
            try {
              content = await downloadChapterContent(chapter.contentOss)
            } catch (error) {
              console.error(`Failed to download chapter ${chapter.id} from OSS:`, error)
              // 使用数据库中的内容
            }
          }
          
          return {
            ...chapter,
            content
          }
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
        await deleteNovelFiles(id)
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
