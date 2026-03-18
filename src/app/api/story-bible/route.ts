import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isOSSAvailable, getStoryBibleFromOSS, saveStoryBibleToOSS } from '@/lib/oss'

const getSchema = z.object({
  novelId: z.string().min(1),
})

const putSchema = z.object({
  novelId: z.string().min(1),
  storyBible: z.unknown(),
})

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId') || ''
    const parsed = getSchema.safeParse({ novelId })
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || '参数验证失败' }, { status: 400 })
    }

    if (!isOSSAvailable()) {
      return NextResponse.json({ success: true, storyBible: null })
    }

    const storyBible = await getStoryBibleFromOSS(parsed.data.novelId)
    return NextResponse.json({ success: true, storyBible })
  } catch (error) {
    console.error('Get story bible error:', error)
    return NextResponse.json({ success: false, error: 'Failed to get story bible' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = putSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || '参数验证失败' }, { status: 400 })
    }

    if (!isOSSAvailable()) {
      return NextResponse.json({ success: false, error: 'OSS 未配置，无法保存作品档案' }, { status: 400 })
    }

    await saveStoryBibleToOSS(parsed.data.novelId, parsed.data.storyBible)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Save story bible error:', error)
    return NextResponse.json({ success: false, error: 'Failed to save story bible' }, { status: 500 })
  }
}

