import { NextRequest, NextResponse } from 'next/server'
import { fetchNovelForExport, generateEpub, generatePdf } from '@/lib/export'
import { exportSchema, validateOrError } from '@/lib/validations/novel'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validation = validateOrError(exportSchema, body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }

    const { novelId, format, ...options } = validation.data

    // 获取小说数据
    const novel = await fetchNovelForExport(novelId)

    if (novel.chapters.length === 0) {
      return NextResponse.json(
        { success: false, error: '小说没有章节，无法导出' },
        { status: 400 }
      )
    }

    // 生成文件
    const result = format === 'epub'
      ? await generateEpub(novel, { ...options, novelId, format })
      : await generatePdf(novel, { ...options, novelId, format })

    // 返回二进制流
    const encodedFilename = encodeURIComponent(result.filename)
    return new NextResponse(result.buffer, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': result.buffer.length.toString(),
        'Content-Disposition': `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[Export] Error:', error)
    const message = error instanceof Error ? error.message : '导出失败'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
