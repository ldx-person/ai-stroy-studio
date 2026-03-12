import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createNovelSchema, updateNovelSchema, validateOrError } from '@/lib/validations/novel'
import { 
  saveNovelToOSS, 
  updateNovelMeta,
  deleteNovelFromOSS,
  isOSSAvailable 
} from '@/lib/oss'
export async function GET() {
  try {
    const novels = await db.novel.findMany({
      include: {
        chapters: {
          select: {
            id: true,
            title: true,
            wordCount: true,
            order: true
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    })
    
    return NextResponse.json({ success: true, novels })
  } catch (error) {
    console.error('Failed to fetch novels:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch novels' }, { status: 500 })
  }
}

// POST - 创建新小说
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Validate input
    const validation = validateOrError(createNovelSchema, body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    
    const { title, description, genre } = validation.data
    
    const novel = await db.novel.create({
      data: {
        title,
        description: description || null,
        genre: genre || null,
        status: 'draft'
      }
    })
    
    // 同步到OSS
    if (isOSSAvailable()) {
      try {
        await saveNovelToOSS(novel.id, {
          title: novel.title,
          genre: novel.genre,
          status: novel.status,
          wordCount: 0,
          description: description || undefined
        })
      } catch (ossError) {
        console.error('同步到OSS失败:', ossError)
        // 继续执行，不影响主流程
      }
    }
    
    return NextResponse.json({ success: true, novel })
  } catch (error) {
    console.error('Failed to create novel:', error)
    return NextResponse.json({ success: false, error: 'Failed to create novel' }, { status: 500 })
  }
}

// PUT - 更新小说状态
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Validate input
    const validation = validateOrError(updateNovelSchema, body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    
    const { id, status, title, description, genre } = validation.data
    
    const updateData: {
      status?: string
      title?: string
      description?: string | null
      genre?: string | null
    } = {}
    
    if (status !== undefined) updateData.status = status
    if (title !== undefined) updateData.title = title
    if (description !== undefined) updateData.description = description
    if (genre !== undefined) updateData.genre = genre
    
    const novel = await db.novel.update({
      where: { id },
      data: updateData
    })
    
    // 同步到OSS
    if (isOSSAvailable()) {
      try {
        await updateNovelMeta(id, {
          title: novel.title,
          genre: novel.genre,
          status: novel.status,
          wordCount: novel.wordCount
        })
        
        // 如果更新了简介，也要保存
        if (description !== undefined && description) {
          const { saveChapterContent } = await import('@/lib/oss')
          // 简介单独保存
          const client = (await import('ali-oss')).default
          const ossClient = new client({
            region: process.env.OSS_REGION || 'oss-cn-beijing',
            accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
            accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
            bucket: process.env.OSS_BUCKET || 'ai-story-stroe',
          })
          await ossClient.put(
            `novels/${id}/description.txt`,
            Buffer.from(description, 'utf-8')
          )
        }
      } catch (ossError) {
        console.error('同步到OSS失败:', ossError)
      }
    }
    
    return NextResponse.json({ success: true, novel })
  } catch (error) {
    console.error('Failed to update novel:', error)
    return NextResponse.json({ success: false, error: 'Failed to update novel' }, { status: 500 })
  }
}

// DELETE - 删除小说
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 })
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
    
    // Delete all chapters first (cascade)
    await db.chapter.deleteMany({
      where: { novelId: id }
    })
    
    // Delete novel
    await db.novel.delete({
      where: { id }
    })
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete novel:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete novel' }, { status: 500 })
  }
}
