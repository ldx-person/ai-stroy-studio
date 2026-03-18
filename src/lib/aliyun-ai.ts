/**
 * AI大模型服务客户端
 *
 * 默认接入 Z.AI 的 GLM-5-Turbo（参考官方文档 https://docs.z.ai/guides/llm/glm-5-turbo）
 * 如果需要兼容旧配置，也会回退到阿里云/智谱的环境变量。
 */

// 优先使用 Z.AI 配置，其次兼容阿里云/智谱的旧配置
const AI_CONFIG = {
  // Z.AI API Key 优先，其次兼容之前的环境变量
  apiKey:
    process.env.ZAI_API_KEY ||
    process.env.ALIYUN_AI_API_KEY ||
    process.env.ZHIPU_AI_API_KEY ||
    '',

  // 默认模型切换为 GLM-5-Turbo
  model:
    process.env.ZAI_MODEL ||
    process.env.ALIYUN_AI_MODEL ||
    process.env.ZHIPU_AI_MODEL ||
    'glm-5-turbo',

  // 默认基地址切换为 Z.AI 的 v4 Chat Completions 兼容接口
  // 示例：POST https://api.z.ai/api/paas/v4/chat/completions
  baseUrl:
    process.env.ZAI_BASE_URL ||
    process.env.ALIYUN_AI_BASE_URL ||
    process.env.ZHIPU_AI_BASE_URL ||
    'https://api.z.ai/api/paas/v4',
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
  return !!AI_CONFIG.apiKey
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
    throw new Error('AI大模型API配置不完整，请检查环境变量 ZAI_API_KEY（或兼容的 ALIYUN_AI_API_KEY / ZHIPU_AI_API_KEY）')
  }

  const { temperature = 0.7, maxTokens = 4096, topP = 0.9 } = options

  const response = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
    },
    body: JSON.stringify({
      model: AI_CONFIG.model,
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

  return data.choices[0].message.content
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
  return AI_CONFIG.model
}
