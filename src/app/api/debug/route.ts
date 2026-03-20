import { NextResponse } from 'next/server'
import OSS from 'ali-oss'

export async function GET() {
  const config = {
    oss: {
      region: process.env.OSS_REGION || '未配置',
      accessKeyId: process.env.OSS_ACCESS_KEY_ID ? `${process.env.OSS_ACCESS_KEY_ID.slice(0, 8)}...` : '未配置',
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET ? '已配置' : '未配置',
      bucket: process.env.OSS_BUCKET || '未配置',
    },
    ai: {
      aliyunApiKey: process.env.ALIYUN_AI_API_KEY ? `${process.env.ALIYUN_AI_API_KEY.slice(0, 8)}...` : '未配置',
      zhipuApiKey: process.env.ZHIPU_AI_API_KEY ? `${process.env.ZHIPU_AI_API_KEY.slice(0, 8)}...` : '未配置',
      model: process.env.ALIYUN_AI_MODEL || process.env.ZHIPU_AI_MODEL || '未配置',
    },
    database: {
      url: process.env.DATABASE_URL ? '已配置' : '未配置',
    },
    nodeEnv: process.env.NODE_ENV
  }
  
  // 直接测试 listOSSNovels 函数
  let ossNovelsResult: Record<string, unknown> = {}
  try {
    const { listOSSNovels } = await import('@/lib/oss')
    const novels = await listOSSNovels()
    ossNovelsResult = { count: novels.length, novels: novels.map(n => ({ id: n.id, title: n.title })) }
  } catch (err) {
    ossNovelsResult = { error: err instanceof Error ? err.message : String(err) }
  }

  // 直接测试 OSS list 返回值
  let ossListResult: Record<string, unknown> = {}
  try {
    const client = new OSS({
      region: process.env.OSS_REGION || 'oss-cn-beijing',
      accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
      bucket: process.env.OSS_BUCKET || 'ai-story-stroe',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (client as any).list({
      prefix: 'novels/',
      delimiter: '/',
      'max-keys': 1000,
    })
    ossListResult = {
      resultKeys: Object.keys(result),
      prefixes: result.prefixes,
      prefixesType: typeof result.prefixes,
      prefixesIsArray: Array.isArray(result.prefixes),
      objectsCount: result.objects?.length ?? 0,
      nextMarker: result.nextMarker,
    }
  } catch (err) {
    ossListResult = { error: err instanceof Error ? err.message : String(err) }
  }

  return NextResponse.json({
    success: true,
    config,
    ossNovelsResult,
    ossListResult,
    timestamp: new Date().toISOString()
  })
}
