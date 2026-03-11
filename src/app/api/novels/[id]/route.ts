import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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
    
    return NextResponse.json({ success: true, novel })
  } catch (error) {
    console.error('Failed to fetch novel:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch novel' }, { status: 500 })
  }
}
