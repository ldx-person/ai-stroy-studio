/**
 * 阿里云百炼大模型服务客户端
 * 使用OpenAI兼容格式调用通义千问模型
 */

// API配置
const ALIYUN_AI_CONFIG = {
  apiKey: process.env.ALIYUN_AI_API_KEY || '',
  model: process.env.ALIYUN_AI_MODEL || 'qwen-turbo', // 通义千问模型
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', // 阿里云百炼API
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
  return !!ALIYUN_AI_CONFIG.apiKey
}

/**
 * 调用阿里云百炼大模型API
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
    throw new Error('阿里云大模型API配置不完整，请检查环境变量ALIYUN_AI_API_KEY')
  }

  const { temperature = 0.7, maxTokens = 4096, topP = 0.9 } = options

  const response = await fetch(`${ALIYUN_AI_CONFIG.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ALIYUN_AI_CONFIG.apiKey}`,
    },
    body: JSON.stringify({
      model: ALIYUN_AI_CONFIG.model,
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
 * 检查阿里云AI配置是否可用
 */
export function isAliyunAIAvailable(): boolean {
  return checkAIConfig()
}

/**
 * 获取当前使用的模型名称
 */
export function getCurrentModel(): string {
  return ALIYUN_AI_CONFIG.model
}
