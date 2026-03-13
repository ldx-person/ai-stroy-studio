import { NextRequest, NextResponse } from 'next/server'
import { getZAI } from '@/lib/zai'
import { ttsSchema, validateOrError } from '@/lib/validations/novel'

// Split text into chunks (max 150 chars for fast mobile response)
function splitTextIntoChunks(text: string, maxLength = 150): string[] {
  const chunks: string[] = []
  
  // Split by sentences (Chinese and English punctuation)
  // Also handle text that doesn't end with punctuation
  const sentences = text.match(/[^。！？.!?]+[。！？.!?]*/g) || [text]
  
  let currentChunk = ''
  for (const sentence of sentences) {
    if (!sentence.trim()) continue
    
    if ((currentChunk + sentence).length <= maxLength) {
      currentChunk += sentence
    } else {
      if (currentChunk) chunks.push(currentChunk.trim())
      // If single sentence is too long, split by maxLength
      if (sentence.length > maxLength) {
        for (let i = 0; i < sentence.length; i += maxLength) {
          chunks.push(sentence.slice(i, i + maxLength).trim())
        }
        currentChunk = ''
      } else {
        currentChunk = sentence
      }
    }
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim())
  
  return chunks.filter(chunk => chunk.length > 0)
}

// POST - Generate TTS audio for text chunk
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Validate input
    const validation = validateOrError(ttsSchema, body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }
    
    const { text, voice = 'tongtong', speed = 1.0 } = validation.data
    
    // Validate speed
    const validSpeed = Math.max(0.5, Math.min(2.0, Number(speed) || 1.0))
    
    // Limit text length for single request (150 chars for fast mobile response)
    const inputText = text.slice(0, 150)
    
    // Use singleton ZAI instance
    const zai = await getZAI()
    
    const response = await zai.audio.tts.create({
      input: inputText,
      voice: voice,
      speed: validSpeed,
      response_format: 'wav',
      stream: false
    })
    
    // Get array buffer from Response object
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(new Uint8Array(arrayBuffer))
    
    // Return audio as response
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'public, max-age=3600'
      }
    })
  } catch (error) {
    console.error('[TTS] API Error:', error)
    const errorMessage = error instanceof Error ? error.message : '语音生成失败'
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}

// GET - Get text chunks info for streaming playback
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const text = searchParams.get('text')
    
    if (!text) {
      return NextResponse.json({ success: false, error: '缺少文本参数' }, { status: 400 })
    }
    
    const chunks = splitTextIntoChunks(text)
    
    return NextResponse.json({
      success: true,
      totalChunks: chunks.length,
      totalLength: text.length,
      chunks: chunks.map((chunk, index) => ({
        index,
        text: chunk,
        length: chunk.length
      }))
    })
  } catch (error) {
    console.error('[TTS] Chunk error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '处理失败' },
      { status: 500 }
    )
  }
}

// PUT - Get text chunks using request body (avoids URL length limit)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { text } = body
    
    if (!text) {
      return NextResponse.json({ success: false, error: '缺少文本参数' }, { status: 400 })
    }
    
    const chunks = splitTextIntoChunks(text)
    
    return NextResponse.json({
      success: true,
      totalChunks: chunks.length,
      totalLength: text.length,
      chunks: chunks.map((chunk, index) => ({
        index,
        text: chunk,
        length: chunk.length
      }))
    })
  } catch (error) {
    console.error('[TTS] PUT Chunk error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '处理失败' },
      { status: 500 }
    )
  }
}
