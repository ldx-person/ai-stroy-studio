/**
 * 测试 GLM-5-turbo 是否可用
 * 会读取 .env.local 中的 ZAI_API_KEY（或 ALIYUN_AI_API_KEY）
 * 运行: node scripts/test-glm5.js  或  bun scripts/test-glm5.js
 */

const fs = require('fs')
const path = require('path')

// 加载 .env.local
const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const apiKey = process.env.ZAI_API_KEY || process.env.ALIYUN_AI_API_KEY || process.env.ZHIPU_AI_API_KEY
const baseUrl = (process.env.ZAI_BASE_URL || process.env.ALIYUN_AI_BASE_URL || 'https://api.z.ai/api/paas/v4').replace(/\/$/, '')
const model = process.env.ZAI_MODEL || process.env.ALIYUN_AI_MODEL || 'glm-5-turbo'

async function test() {
  if (!apiKey) {
    console.error('未找到 API Key，请在 .env.local 中配置 ZAI_API_KEY 或 ALIYUN_AI_API_KEY')
    process.exit(1)
  }
  console.log('使用模型:', model)
  console.log('请求地址:', baseUrl + '/chat/completions')
  console.log('发送测试请求...\n')

  const url = baseUrl + '/chat/completions'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'user', content: '请用一句话介绍你自己，不超过30字。' }
      ],
      max_tokens: 128,
      temperature: 0.7,
    }),
  })

  const text = await res.text()
  if (!res.ok) {
    console.error('请求失败:', res.status, res.statusText)
    console.error('响应:', text)
    process.exit(1)
  }

  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    console.error('响应不是合法 JSON:', text.slice(0, 200))
    process.exit(1)
  }

  const message = data.choices?.[0]?.message
  const content = message?.content?.trim()
  const reasoning = message?.reasoning_content?.trim()
  const output = content || reasoning

  if (!output) {
    console.error('响应中无可用输出(content/reasoning_content):', JSON.stringify(data, null, 2).slice(0, 500))
    process.exit(1)
  }

  console.log('GLM 测试调用成功。')
  console.log('模型回复:', output)
  if (data.usage) {
    console.log('\nToken 使用:', data.usage)
  }
}

test().catch((err) => {
  console.error('测试失败:', err.message)
  process.exit(1)
})
