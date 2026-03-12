import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { 
  listOSSNovels, 
  getNovelFromOSS, 
  saveNovelToOSS,
  isOSSAvailable
} from '@/lib/oss'

/**
 * GET - 从OSS同步所有小说到本地数据库
 */
export async function GET() {
  try {
    if (!isOSSAvailable()) {
      return NextResponse.json({ 
        success: false, 
        error: 'OSS配置不可用' 
      }, { status: 500 })
    }
    
    // 获取OSS中所有小说
    const ossNovels = await listOSSNovels()
    
    let syncedCount = 0
    let errorCount = 0
    const syncedNovels: string[] = []
    const errors: string[] = []
    
    for (const novelMeta of ossNovels) {
      try {
        // 检查本地是否已存在
        const existingNovel = await db.novel.findUnique({
          where: { id: novelMeta.id }
        })
        
        if (existingNovel) {
          // 更新现有小说
          await db.novel.update({
            where: { id: novelMeta.id },
            data: {
              title: novelMeta.title,
              genre: novelMeta.genre,
              status: novelMeta.status,
              wordCount: novelMeta.wordCount
            }
          })
        } else {
          // 创建新小说
          await db.novel.create({
            data: {
              id: novelMeta.id,
              title: novelMeta.title,
              genre: novelMeta.genre,
              status: novelMeta.status,
              wordCount: novelMeta.wordCount,
              description: '',
              createdAt: new Date(novelMeta.createdAt),
              updatedAt: new Date(novelMeta.updatedAt)
            }
          })
        }
        
        // 获取完整数据
        const fullData = await getNovelFromOSS(novelMeta.id)
        
        if (fullData) {
          // 更新简介
          if (fullData.description) {
            await db.novel.update({
              where: { id: novelMeta.id },
              data: { description: fullData.description }
            })
          }
          
          // 同步章节
          for (const chapter of fullData.chapters) {
            const existingChapter = await db.chapter.findUnique({
              where: { id: chapter.id }
            })
            
            if (existingChapter) {
              await db.chapter.update({
                where: { id: chapter.id },
                data: {
                  title: chapter.title,
                  content: chapter.content,
                  wordCount: chapter.wordCount,
                  order: chapter.order,
                  isPublished: chapter.isPublished
                }
              })
            } else {
              await db.chapter.create({
                data: {
                  id: chapter.id,
                  novelId: novelMeta.id,
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
          }
        }
        
        syncedCount++
        syncedNovels.push(novelMeta.title)
      } catch (error) {
        errorCount++
        errors.push(`${novelMeta.title}: ${error instanceof Error ? error.message : '同步失败'}`)
      }
    }
    
    return NextResponse.json({
      success: true,
      message: `同步完成: ${syncedCount} 成功, ${errorCount} 失败`,
      syncedCount,
      errorCount,
      syncedNovels,
      errors: errors.length > 0 ? errors : undefined
    })
  } catch (error) {
    console.error('OSS同步失败:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : '同步失败' 
    }, { status: 500 })
  }
}

/**
 * POST - 将本地数据同步到OSS
 */
export async function POST(request: NextRequest) {
  try {
    if (!isOSSAvailable()) {
      return NextResponse.json({ 
        success: false, 
        error: 'OSS配置不可用' 
      }, { status: 500 })
    }
    
    const body = await request.json()
    const { novelId } = body
    
    if (novelId) {
      // 同步单个小说
      const novel = await db.novel.findUnique({
        where: { id: novelId },
        include: {
          chapters: { orderBy: { order: 'asc' } },
          characters: true
        }
      })
      
      if (!novel) {
        return NextResponse.json({ 
          success: false, 
          error: '小说不存在' 
        }, { status: 404 })
      }
      
      await saveNovelToOSS(novelId, {
        title: novel.title,
        genre: novel.genre,
        status: novel.status,
        wordCount: novel.wordCount,
        description: novel.description || undefined,
        characters: novel.characters.map(ch => ({
          id: ch.id,
          name: ch.name,
          description: ch.description,
          avatar: ch.avatar,
          createdAt: ch.createdAt.toISOString(),
          updatedAt: ch.updatedAt.toISOString()
        })),
        chapters: novel.chapters.map(ch => ({
          id: ch.id,
          title: ch.title,
          wordCount: ch.wordCount,
          order: ch.order,
          isPublished: ch.isPublished,
          createdAt: ch.createdAt.toISOString(),
          updatedAt: ch.updatedAt.toISOString(),
          content: ch.content
        }))
      })
      
      return NextResponse.json({
        success: true,
        message: `小说 "${novel.title}" 已同步到OSS`
      })
    } else {
      // 同步所有小说
      const novels = await db.novel.findMany({
        include: {
          chapters: { orderBy: { order: 'asc' } },
          characters: true
        }
      })
      
      let syncedCount = 0
      const syncedNovels: string[] = []
      
      for (const novel of novels) {
        await saveNovelToOSS(novel.id, {
          title: novel.title,
          genre: novel.genre,
          status: novel.status,
          wordCount: novel.wordCount,
          description: novel.description || undefined,
          characters: novel.characters.map(ch => ({
            id: ch.id,
            name: ch.name,
            description: ch.description,
            avatar: ch.avatar,
            createdAt: ch.createdAt.toISOString(),
            updatedAt: ch.updatedAt.toISOString()
          })),
          chapters: novel.chapters.map(ch => ({
            id: ch.id,
            title: ch.title,
            wordCount: ch.wordCount,
            order: ch.order,
            isPublished: ch.isPublished,
            createdAt: ch.createdAt.toISOString(),
            updatedAt: ch.updatedAt.toISOString(),
            content: ch.content
          }))
        })
        
        syncedCount++
        syncedNovels.push(novel.title)
      }
      
      return NextResponse.json({
        success: true,
        message: `已同步 ${syncedCount} 本小说到OSS`,
        syncedCount,
        syncedNovels
      })
    }
  } catch (error) {
    console.error('同步到OSS失败:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : '同步失败' 
    }, { status: 500 })
  }
}
