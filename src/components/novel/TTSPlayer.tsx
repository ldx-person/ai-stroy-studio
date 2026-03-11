'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Loader2, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface TextChunk {
  index: number
  text: string
  length: number
}

interface TTSPlayerProps {
  content: string
  disabled?: boolean
}

// Voice options
const VOICE_OPTIONS = [
  { value: 'tongtong', label: '童童（温暖亲切）' },
  { value: 'chuichui', label: '吹吹（活泼可爱）' },
  { value: 'xiaochen', label: '小晨（沉稳专业）' },
  { value: 'douji', label: '豆豆（自然流畅）' },
  { value: 'luodo', label: '罗多（富有感染力）' },
]

export function TTSPlayer({ content, disabled }: TTSPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isTTSLoading, setIsTTSLoading] = useState(false)
  const [ttsVoice, setTtsVoice] = useState('tongtong')
  const [ttsSpeed, setTtsSpeed] = useState(1.0)
  const [textChunks, setTextChunks] = useState<TextChunk[]>([])
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUnlockedRef = useRef(false)
  const currentAudioUrlRef = useRef<string | null>(null)
  
  const { toast } = useToast()

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
        audioRef.current.onended = null
        audioRef.current.onerror = null
        audioRef.current = null
      }
      if (currentAudioUrlRef.current) {
        URL.revokeObjectURL(currentAudioUrlRef.current)
        currentAudioUrlRef.current = null
      }
    }
  }, [])

  const stopTTS = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current = null
    }
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current)
      currentAudioUrlRef.current = null
    }
    setIsPlaying(false)
    setIsTTSLoading(false)
    setTextChunks([])
    setCurrentChunkIndex(0)
    audioUnlockedRef.current = false
  }, [])

  const unlockAudio = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(true), 100)
      
      if (audioUnlockedRef.current) {
        clearTimeout(timeout)
        resolve(true)
        return
      }
      
      try {
        const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA')
        const playPromise = silentAudio.play()
        
        if (playPromise !== undefined) {
          playPromise.then(() => {
            clearTimeout(timeout)
            audioUnlockedRef.current = true
            silentAudio.pause()
            resolve(true)
          }).catch(() => {
            clearTimeout(timeout)
            resolve(true)
          })
        } else {
          clearTimeout(timeout)
          resolve(true)
        }
      } catch {
        clearTimeout(timeout)
        resolve(true)
      }
    })
  }, [])

  const playChunk = useCallback(async (chunkIndex: number, chunks?: TextChunk[]) => {
    const chunksToUse = chunks || textChunks
    if (chunkIndex >= chunksToUse.length) {
      stopTTS()
      toast({ title: '播放完成' })
      return
    }

    const chunk = chunksToUse[chunkIndex]
    setIsTTSLoading(true)

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: chunk.text,
          voice: ttsVoice,
          speed: ttsSpeed
        })
      })

      if (!res.ok) {
        let errorMsg = 'TTS请求失败'
        try {
          const errorData = await res.json()
          errorMsg = errorData.error || errorMsg
        } catch {
          errorMsg = `请求失败: ${res.status}`
        }
        throw new Error(errorMsg)
      }

      const audioBlob = await res.blob()
      if (audioBlob.size === 0) {
        throw new Error('音频数据为空')
      }
      
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
        audioRef.current.onended = null
        audioRef.current.onerror = null
      }
      
      if (currentAudioUrlRef.current) {
        URL.revokeObjectURL(currentAudioUrlRef.current)
      }
      
      const audioUrl = URL.createObjectURL(audioBlob)
      currentAudioUrlRef.current = audioUrl

      audioRef.current = new Audio(audioUrl)
      audioRef.current.playbackRate = 1.0
      
      audioRef.current.onended = () => {
        setCurrentChunkIndex(prev => prev + 1)
      }

      audioRef.current.onerror = () => {
        toast({ title: '播放出错', variant: 'destructive' })
        stopTTS()
      }

      await audioRef.current.play()
      setIsPlaying(true)
      setIsTTSLoading(false)
    } catch (error) {
      console.error('TTS error:', error)
      const message = error instanceof Error ? error.message : '语音生成失败'
      toast({ title: message, variant: 'destructive' })
      stopTTS()
    }
  }, [textChunks, ttsVoice, ttsSpeed, stopTTS, toast])

  useEffect(() => {
    if (isPlaying && textChunks.length > 0 && currentChunkIndex > 0) {
      playChunk(currentChunkIndex)
    }
  }, [currentChunkIndex, isPlaying, textChunks.length, playChunk])

  const handlePlayTTS = async () => {
    const trimmedContent = content.trim()
    if (!trimmedContent) {
      toast({ title: '没有可播放的内容', variant: 'destructive' })
      return
    }

    if (isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause()
      }
      setIsPlaying(false)
      return
    }

    if (audioRef.current && textChunks.length > 0) {
      try {
        await audioRef.current.play()
        setIsPlaying(true)
      } catch {
        audioRef.current = null
        setTextChunks([])
        setCurrentChunkIndex(0)
        handlePlayTTS()
      }
      return
    }

    unlockAudio()
    setIsTTSLoading(true)

    try {
      const res = await fetch('/api/tts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmedContent })
      })
      const data = await res.json()

      if (data.success) {
        setTextChunks(data.chunks)
        setCurrentChunkIndex(0)
        await playChunk(0, data.chunks)
      } else {
        toast({ title: '文本处理失败', variant: 'destructive' })
        setIsTTSLoading(false)
      }
    } catch (error) {
      console.error('[TTS] Play error:', error)
      toast({ title: '初始化播放失败', variant: 'destructive' })
      setIsTTSLoading(false)
    }
  }

  const handleSkipChunk = (direction: 'prev' | 'next') => {
    if (direction === 'prev' && currentChunkIndex > 0) {
      setCurrentChunkIndex(currentChunkIndex - 1)
    } else if (direction === 'next' && currentChunkIndex < textChunks.length - 1) {
      setCurrentChunkIndex(currentChunkIndex + 1)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Volume2 className="w-4 h-4" />
          语音播放
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Voice Selection */}
        <div className="space-y-2">
          <Label className="text-xs md:text-sm">声音</Label>
          <Select value={ttsVoice} onValueChange={setTtsVoice}>
            <SelectTrigger className="text-xs md:text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOICE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value} className="text-xs md:text-sm">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Speed Control */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-xs md:text-sm">语速</Label>
            <span className="text-xs md:text-sm text-muted-foreground">{ttsSpeed.toFixed(1)}x</span>
          </div>
          <Slider
            value={[ttsSpeed]}
            onValueChange={([value]) => setTtsSpeed(value)}
            min={0.5}
            max={2.0}
            step={0.1}
          />
        </div>

        {/* Play Controls */}
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 md:h-11 md:w-11 touch-manipulation"
            onClick={() => handleSkipChunk('prev')}
            disabled={currentChunkIndex === 0 || !isPlaying}
          >
            <SkipBack className="w-4 h-4" />
          </Button>
          <Button
            size="lg"
            className="w-12 h-12 md:w-14 md:h-14 rounded-full touch-manipulation"
            onClick={handlePlayTTS}
            disabled={isTTSLoading || disabled || !content.trim()}
          >
            {isTTSLoading ? (
              <Loader2 className="w-5 h-5 md:w-6 md:h-6 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-5 h-5 md:w-6 md:h-6" />
            ) : (
              <Play className="w-5 h-5 md:w-6 md:h-6 ml-1" />
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 md:h-11 md:w-11 touch-manipulation"
            onClick={() => handleSkipChunk('next')}
            disabled={currentChunkIndex >= textChunks.length - 1 || !isPlaying}
          >
            <SkipForward className="w-4 h-4" />
          </Button>
        </div>

        {/* Progress */}
        {textChunks.length > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs md:text-sm text-muted-foreground">
              <span>段落 {currentChunkIndex + 1} / {textChunks.length}</span>
              <span>{Math.round((currentChunkIndex / textChunks.length) * 100)}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className="bg-amber-500 h-2 rounded-full transition-all"
                style={{ width: `${(currentChunkIndex / textChunks.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Stop Button */}
        {isPlaying && (
          <Button 
            variant="destructive" 
            className="w-full touch-manipulation"
            onClick={stopTTS}
          >
            停止播放
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
