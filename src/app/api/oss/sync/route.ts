import { NextRequest, NextResponse } from 'next/server'

/**
 * 历史：曾将 OSS 同步到本地 SQLite。
 * 现架构以 OSS 为唯一真相源，此接口保留为兼容前端调用，不再写入作品表。
 */
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({
    success: true,
    message: '作品数据以 OSS 为准，无需同步到本地库',
    syncedCount: 0,
    errorCount: 0,
    syncedNovels: [] as string[],
  })
}

export async function POST(_request: NextRequest) {
  return NextResponse.json({
    success: true,
    message: '已采用 OSS 真相源；如需整本回写 OSS，请使用作品保存流程',
  })
}
