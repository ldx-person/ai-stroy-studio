/**
 * AI大模型服务客户端
 *
 * 默认接入 Z.AI 的 GLM-5-Turbo（参考官方文档 https://docs.z.ai/guides/llm/glm-5-turbo）
 * 如果需要兼容旧配置，也会回退到阿里云/智谱的环境变量。
 */

/**
 * 按「实际使用的 Key」选择默认 baseUrl / model，避免只配 ALIYUN_AI_API_KEY 时仍请求 Z.AI 端点导致调用失败。
 * 优先级：ZAI_API_KEY > ALIYUN_AI_API_KEY > ZHIPU_AI_API_KEY
 */
function resolveAIConfig(): { apiKey: string; baseUrl: string; model: string } {
  const zaiKey = (process.env.ZAI_API_KEY || '').trim()
  const aliyunKey = (process.env.ALIYUN_AI_API_KEY || '').trim()
  const zhipuKey = (process.env.ZHIPU_AI_API_KEY || '').trim()

  const stripTrailingSlash = (u: string) => u.replace(/\/+$/, '')

  if (zaiKey) {
    return {
      apiKey: zaiKey,
      baseUrl: stripTrailingSlash(process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4'),
      model: process.env.ZAI_MODEL || 'glm-5-turbo',
    }
  }
  if (aliyunKey) {
    return {
      apiKey: aliyunKey,
      baseUrl: stripTrailingSlash(
        process.env.ALIYUN_AI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
      ),
      model: process.env.ALIYUN_AI_MODEL || 'qwen-turbo',
    }
  }
  if (zhipuKey) {
    return {
      apiKey: zhipuKey,
      baseUrl: stripTrailingSlash(
        process.env.ZHIPU_AI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'
      ),
      model: process.env.ZHIPU_AI_MODEL || 'glm-4-flash',
    }
  }
  return { apiKey: '', baseUrl: '', model: '' }
}

// 消息类型
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// 响应类型
interface ChatCompletionResponse {
  id: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// 检查配置是否完整
function checkAIConfig(): boolean {
  return !!resolveAIConfig().apiKey
}

/**
 * 调用智谱AI大模型API
 * @param messages 消息列表
 * @param options 可选参数
 * @returns 生成的文本内容
 */
export async function callAliyunAI(
  messages: ChatMessage[],
  options: {
    temperature?: number
    maxTokens?: number
    topP?: number
  } = {}
): Promise<string> {
  if (!checkAIConfig()) {
    throw new Error(
      'AI大模型API配置不完整，请在 .env.local 中配置其一：ZAI_API_KEY，或 ALIYUN_AI_API_KEY（阿里云百炼），或 ZHIPU_AI_API_KEY（智谱）'
    )
  }

  const cfg = resolveAIConfig()
  const { temperature = 0.7, maxTokens = 4096, topP = 0.9 } = options

  const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      top_p: topP,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    let errorMsg = `API请求失败: ${response.status}`
    try {
      const errorJson = JSON.parse(errorText)
      errorMsg = errorJson.error?.message || errorJson.message || errorJson.error?.code || errorMsg
    } catch {
      // 无法解析JSON，使用原始文本
    }
    throw new Error(errorMsg)
  }

  const data: ChatCompletionResponse = await response.json()
  
  if (!data.choices || data.choices.length === 0) {
    throw new Error('AI返回结果为空')
  }

  const text = extractAssistantText(data.choices[0]?.message)
  if (!text.trim()) {
    throw new Error('AI 返回的文本为空（可能是模型字段格式变更，请查看日志）')
  }
  return text
}

/** 兼容字符串 content 与部分厂商返回的数组片段结构 */
function extractAssistantText(message: { content?: unknown } | undefined): string {
  if (!message) return ''
  const c = message.content
  if (c == null) return ''
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((part: unknown) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && part !== null) {
          const o = part as Record<string, unknown>
          if (typeof o.text === 'string') return o.text
          if (typeof o.content === 'string') return o.content
        }
        return ''
      })
      .join('')
  }
  return String(c)
}

/**
 * 带重试的AI调用
 * @param messages 消息列表
 * @param maxRetries 最大重试次数
 * @param delayMs 重试间隔毫秒
 */
export async function callAliyunAIWithRetry(
  messages: ChatMessage[],
  maxRetries: number = 3,
  delayMs: number = 2000,
  options: {
    temperature?: number
    maxTokens?: number
    topP?: number
  } = {}
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await callAliyunAI(messages, options)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : ''
      
      // 如果是429错误（速率限制），等待更长时间后重试
      if (errorMsg.includes('429') || errorMsg.includes('Too many requests') || errorMsg.includes('rate limit')) {
        const waitTime = delayMs * (attempt + 2)
        console.log(`Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
        continue
      }
      
      // 其他错误，也重试
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
        continue
      }
      
      throw error
    }
  }
  
  throw new Error('AI调用重试次数已达上限')
}

/**
 * 检查智谱AI配置是否可用
 */
export function isAliyunAIAvailable(): boolean {
  return checkAIConfig()
}

/**
 * 获取当前使用的模型名称
 */
export function getCurrentModel(): string {
  return resolveAIConfig().model
}

/** 供 /api/debug 等查看「实际生效」的服务商与端点（不含密钥） */
export function getResolvedAIClientSummary(): {
  provider: 'zai' | 'aliyun' | 'zhipu' | 'none'
  baseUrl: string
  model: string
  hasApiKey: boolean
} {
  const zaiKey = (process.env.ZAI_API_KEY || '').trim()
  const aliyunKey = (process.env.ALIYUN_AI_API_KEY || '').trim()
  const zhipuKey = (process.env.ZHIPU_AI_API_KEY || '').trim()
  const cfg = resolveAIConfig()
  const provider: 'zai' | 'aliyun' | 'zhipu' | 'none' = zaiKey
    ? 'zai'
    : aliyunKey
      ? 'aliyun'
      : zhipuKey
        ? 'zhipu'
        : 'none'
  return {
    provider,
    baseUrl: cfg.baseUrl || '—',
    model: cfg.model || '—',
    hasApiKey: !!cfg.apiKey,
  }
}
