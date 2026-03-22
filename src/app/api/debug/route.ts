import { NextResponse } from 'next/server'
import { getResolvedAIClientSummary } from '@/lib/aliyun-ai'

export async function GET() {
  const aiResolved = getResolvedAIClientSummary()
  const config = {
    oss: {
      region: process.env.OSS_REGION || '未配置',
      accessKeyId: process.env.OSS_ACCESS_KEY_ID ? `${process.env.OSS_ACCESS_KEY_ID.slice(0, 8)}...` : '未配置',
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET ? '已配置' : '未配置',
      bucket: process.env.OSS_BUCKET || '未配置',
    },
    ai: {
      /** 按 ZAI > 阿里云 > 智谱 优先级实际选用的服务商 */
      activeProvider: aiResolved.provider,
      activeBaseUrl: aiResolved.baseUrl,
      activeModel: aiResolved.model,
      hasActiveApiKey: aiResolved.hasApiKey,
      zaiApiKey: process.env.ZAI_API_KEY ? `${process.env.ZAI_API_KEY.slice(0, 8)}...` : '未配置',
      aliyunApiKey: process.env.ALIYUN_AI_API_KEY ? `${process.env.ALIYUN_AI_API_KEY.slice(0, 8)}...` : '未配置',
      zhipuApiKey: process.env.ZHIPU_AI_API_KEY ? `${process.env.ZHIPU_AI_API_KEY.slice(0, 8)}...` : '未配置',
    },
    database: {
      url: process.env.DATABASE_URL ? '已配置' : '未配置',
    },
    nodeEnv: process.env.NODE_ENV
  }
  
  return NextResponse.json({
    success: true,
    config,
    timestamp: new Date().toISOString()
  })
}
