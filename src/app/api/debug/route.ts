import { NextResponse } from 'next/server'

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
  
  return NextResponse.json({
    success: true,
    config,
    timestamp: new Date().toISOString()
  })
}
