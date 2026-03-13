'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Progress } from '@/components/ui/progress'
import { 
  BookOpen, 
  Plus, 
  Edit3, 
  Trash2, 
  ChevronLeft, 
  ChevronRight, 
  Sparkles, 
  FileText,
  MoreVertical,
  PenTool,
  Loader2,
  BookMarked,
  Play,
  Pause,
  Volume2,
  SkipForward,
  SkipBack,
  Menu,
  Home,
  List,
  Settings,
  X,
  Wand2,
  CheckCircle2,
  AlertCircle
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Toaster } from '@/components/ui/toaster'
import { TTSPlayer, ChapterList, NovelCard } from '@/components/novel'

// Types
interface Novel {
  id: string
  title: string
  description: string | null
  cover: string | null
  genre: string | null
  status: string
  wordCount: number
  chapters: Chapter[]
  createdAt: string
  updatedAt: string
}

interface Chapter {
  id: string
  novelId: string
  title: string
  content: string
  wordCount: number
  order: number
  isPublished: boolean
  createdAt: string
  updatedAt: string
}

interface TextChunk {
  index: number
  text: string
  length: number
}

// Chapter outline type
interface ChapterOutline {
  index: number
  title: string
  outline: string
  estimatedWords: number
}

// Story outline type
interface StoryOutline {
  beginning: string
  middle: string
  ending: string
  chapters: ChapterOutline[]
  totalWords: number
  chapterCount: number
}

// Voice options
const VOICE_OPTIONS = [
  { value: 'tongtong', label: '童童（温暖亲切）' },
  { value: 'chuichui', label: '吹吹（活泼可爱）' },
  { value: 'xiaochen', label: '小晨（沉稳专业）' },
  { value: 'douji', label: '豆豆（自然流畅）' },
  { value: 'luodo', label: '罗多（富有感染力）' },
]

type ViewMode = 'list' | 'editor'

// Main Component
export default function NovelWriterApp() {
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [novels, setNovels] = useState<Novel[]>([])
  const [currentNovel, setCurrentNovel] = useState<Novel | null>(null)
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null)
  const [isCreatingNovel, setIsCreatingNovel] = useState(false)
  const [isCreatingChapter, setIsCreatingChapter] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isAILoading, setIsAILoading] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState('')
  
  // Form states
  const [newNovel, setNewNovel] = useState({ title: '', description: '', genre: '' })
  const [newChapter, setNewChapter] = useState({ title: '' })
  const [editingContent, setEditingContent] = useState('')
  
  // TTS states
  const [isPlaying, setIsPlaying] = useState(false)
  const [isTTSLoading, setIsTTSLoading] = useState(false)
  const [ttsVoice, setTtsVoice] = useState('tongtong')
  const [ttsSpeed, setTtsSpeed] = useState(1.0)
  const [textChunks, setTextChunks] = useState<TextChunk[]>([])
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUnlockedRef = useRef(false)
  const currentAudioUrlRef = useRef<string | null>(null) // Track current blob URL for cleanup
  
  // Mobile states
  const [showChapterSheet, setShowChapterSheet] = useState(false)
  const [activeTab, setActiveTab] = useState('write')
  
  // Smart generation states
  const [showSmartGenerate, setShowSmartGenerate] = useState(false)
  const [smartGenNovel, setSmartGenNovel] = useState<Novel | null>(null)
  const [smartGenSettings, setSmartGenSettings] = useState({ totalWords: 10000, chapterCount: 10 })
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false)
  const [generatedOutline, setGeneratedOutline] = useState<StoryOutline | null>(null)
  const [isGeneratingChapters, setIsGeneratingChapters] = useState(false)
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0, currentTitle: '' })
  
  const { toast } = useToast()

  // Detect mobile
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Fetch novels - initial load
  useEffect(() => {
    let isMounted = true
    const fetchNovels = async () => {
      try {
        const res = await fetch('/api/novels')
        const data = await res.json()
        if (data.success && isMounted) {
          setNovels(data.novels)
        }
      } catch (error) {
        console.error('Failed to fetch novels:', error)
      }
    }
    fetchNovels()
    return () => { isMounted = false }
  }, [])

  // Cleanup audio on unmount
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

  // Save chapter content - 使用函数式更新避免闭包问题
  const saveChapterContent = useCallback(async (content: string, chapterId: string) => {
    if (!chapterId) return
    
    const wordCount = content.length
    try {
      const res = await fetch('/api/chapters', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: chapterId,
          content,
          wordCount
        })
      })
      const data = await res.json()
      if (data.success) {
        // 使用函数式更新，确保使用最新的状态
        setCurrentNovel(prev => {
          if (!prev) return prev
          const updatedChapters = prev.chapters.map(ch => 
            ch.id === chapterId ? { ...ch, content, wordCount } : ch
          )
          return { ...prev, chapters: updatedChapters }
        })
        // 更新当前章节（只有当保存的是当前章节时）
        setCurrentChapter(prev => {
          if (!prev || prev.id !== chapterId) return prev
          return { ...prev, content, wordCount }
        })
      }
    } catch (error) {
      console.error('Auto-save failed:', error)
    }
  }, [])

  // Auto-save content - 在定时器启动时记录章节ID
  useEffect(() => {
    if (!currentChapter || !editingContent) return
    
    // 在定时器启动时记录当前章节ID
    const chapterIdToSave = currentChapter.id
    
    const timer = setTimeout(() => {
      saveChapterContent(editingContent, chapterIdToSave)
    }, 2000)
    
    return () => clearTimeout(timer)
  }, [editingContent, currentChapter, saveChapterContent])

  // Stop TTS when chapter changes
  useEffect(() => {
    stopTTS()
  }, [currentChapter?.id])

  // Create novel
  const handleCreateNovel = async () => {
    if (!newNovel.title.trim()) {
      toast({ title: '请输入小说标题', variant: 'destructive' })
      return
    }
    
    setIsLoading(true)
    try {
      const res = await fetch('/api/novels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newNovel)
      })
      const data = await res.json()
      if (data.success) {
        setNovels([...novels, data.novel])
        const createdNovel = data.novel
        setNewNovel({ title: '', description: '', genre: '' })
        setIsCreatingNovel(false)
        toast({ title: '小说创建成功！' })
        
        // If has description, ask if user wants smart generation
        if (createdNovel.description && createdNovel.description.length >= 20) {
          setSmartGenNovel(createdNovel)
          setShowSmartGenerate(true)
        }
      }
    } catch (error) {
      toast({ title: '创建失败', variant: 'destructive' })
    }
    setIsLoading(false)
  }

  // Delete novel
  const handleDeleteNovel = async (novelId: string) => {
    if (!confirm('确定要删除这本小说吗？所有章节也将被删除。')) return
    
    try {
      const res = await fetch(`/api/novels?id=${novelId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setNovels(novels.filter(n => n.id !== novelId))
        toast({ title: '小说已删除' })
      }
    } catch (error) {
      toast({ title: '删除失败', variant: 'destructive' })
    }
  }

  // Update novel status
  const handleUpdateNovelStatus = async (novelId: string, status: string) => {
    try {
      const res = await fetch('/api/novels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: novelId, status })
      })
      const data = await res.json()
      if (data.success) {
        setNovels(novels.map(n => n.id === novelId ? { ...n, status } : n))
        toast({ title: '状态已更新' })
      }
    } catch (error) {
      toast({ title: '更新失败', variant: 'destructive' })
    }
  }

  // Open novel editor
  const openNovelEditor = async (novel: Novel) => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/novels/${novel.id}`)
      const data = await res.json()
      if (data.success) {
        setCurrentNovel(data.novel)
        if (data.novel.chapters.length > 0) {
          const firstChapter = data.novel.chapters.sort((a: Chapter, b: Chapter) => a.order - b.order)[0]
          setCurrentChapter(firstChapter)
          setEditingContent(firstChapter.content)
        } else {
          setCurrentChapter(null)
          setEditingContent('')
        }
        setViewMode('editor')
        setActiveTab('write')
      }
    } catch (error) {
      toast({ title: '加载失败', variant: 'destructive' })
    }
    setIsLoading(false)
  }

  // Create chapter
  const handleCreateChapter = async () => {
    if (!currentNovel || !newChapter.title.trim()) {
      toast({ title: '请输入章节标题', variant: 'destructive' })
      return
    }
    
    setIsLoading(true)
    try {
      const res = await fetch('/api/chapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          novelId: currentNovel.id,
          title: newChapter.title,
          order: currentNovel.chapters.length
        })
      })
      const data = await res.json()
      if (data.success) {
        const updatedNovel = { ...currentNovel, chapters: [...currentNovel.chapters, data.chapter] }
        setCurrentNovel(updatedNovel)
        setCurrentChapter(data.chapter)
        setEditingContent('')
        setNewChapter({ title: '' })
        setIsCreatingChapter(false)
        setShowChapterSheet(false)
        toast({ title: '章节创建成功！' })
      }
    } catch (error) {
      toast({ title: '创建失败', variant: 'destructive' })
    }
    setIsLoading(false)
  }

  // Delete chapter
  const handleDeleteChapter = async (chapterId: string) => {
    if (!confirm('确定要删除这个章节吗？')) return
    
    try {
      const res = await fetch(`/api/chapters?id=${chapterId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success && currentNovel) {
        const updatedChapters = currentNovel.chapters.filter(ch => ch.id !== chapterId)
        const updatedNovel = { ...currentNovel, chapters: updatedChapters }
        setCurrentNovel(updatedNovel)
        
        if (currentChapter?.id === chapterId) {
          if (updatedChapters.length > 0) {
            const firstChapter = updatedChapters.sort((a, b) => a.order - b.order)[0]
            setCurrentChapter(firstChapter)
            setEditingContent(firstChapter.content)
          } else {
            setCurrentChapter(null)
            setEditingContent('')
          }
        }
        toast({ title: '章节已删除' })
      }
    } catch (error) {
      toast({ title: '删除失败', variant: 'destructive' })
    }
  }

  // AI Continue Writing
  const handleAIContinue = async () => {
    if (!editingContent || !currentNovel) {
      toast({ title: '请先写一些内容', variant: 'destructive' })
      return
    }
    
    setIsAILoading(true)
    setAiSuggestion('')
    
    try {
      const res = await fetch('/api/ai/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: editingContent,
          novelTitle: currentNovel.title,
          chapterTitle: currentChapter?.title,
          genre: currentNovel.genre
        })
      })
      const data = await res.json()
      if (data.success) {
        setAiSuggestion(data.suggestion)
        toast({ title: 'AI续写建议已生成！' })
      } else {
        toast({ title: data.error || 'AI生成失败', variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'AI生成失败', variant: 'destructive' })
    }
    setIsAILoading(false)
  }

  // AI Suggest Title
  const handleAITitle = async () => {
    if (!editingContent) {
      toast({ title: '请先写一些内容', variant: 'destructive' })
      return
    }
    
    setIsAILoading(true)
    
    try {
      const res = await fetch('/api/ai/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editingContent })
      })
      const data = await res.json()
      if (data.success && currentChapter) {
        const res2 = await fetch('/api/chapters', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: currentChapter.id,
            title: data.title
          })
        })
        const data2 = await res2.json()
        if (data2.success) {
          const updatedChapter = { ...currentChapter, title: data.title }
          setCurrentChapter(updatedChapter)
          if (currentNovel) {
            const updatedChapters = currentNovel.chapters.map(ch => 
              ch.id === currentChapter.id ? updatedChapter : ch
            )
            setCurrentNovel({ ...currentNovel, chapters: updatedChapters })
          }
          toast({ title: '标题已更新！' })
        }
      }
    } catch (error) {
      toast({ title: 'AI生成失败', variant: 'destructive' })
    }
    setIsAILoading(false)
  }

  // Apply AI suggestion
  const applySuggestion = () => {
    if (aiSuggestion) {
      setEditingContent(editingContent + '\n\n' + aiSuggestion)
      setAiSuggestion('')
    }
  }

  // Calculate total word count
  const getTotalWordCount = (novel: Novel) => {
    return novel.chapters.reduce((sum, ch) => sum + ch.wordCount, 0)
  }

  // Navigate chapters
  const navigateChapter = (direction: 'prev' | 'next') => {
    if (!currentNovel || !currentChapter) return
    
    const sortedChapters = [...currentNovel.chapters].sort((a, b) => a.order - b.order)
    const currentIndex = sortedChapters.findIndex(ch => ch.id === currentChapter.id)
    
    if (direction === 'prev' && currentIndex > 0) {
      const prevChapter = sortedChapters[currentIndex - 1]
      setCurrentChapter(prevChapter)
      setEditingContent(prevChapter.content)
    } else if (direction === 'next' && currentIndex < sortedChapters.length - 1) {
      const nextChapter = sortedChapters[currentIndex + 1]
      setCurrentChapter(nextChapter)
      setEditingContent(nextChapter.content)
    }
    setShowChapterSheet(false)
  }

  // TTS Functions
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
      const timeout = setTimeout(() => {
        resolve(true)
      }, 100)
      
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
    const content = editingContent.trim()
    if (!content) {
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
        body: JSON.stringify({ text: content })
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

  // Select chapter
  const selectChapter = (chapter: Chapter) => {
    setCurrentChapter(chapter)
    setEditingContent(chapter.content)
    setAiSuggestion('')
    setShowChapterSheet(false)
  }

  // Status badge color
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ongoing': return 'bg-green-500/10 text-green-500'
      case 'completed': return 'bg-blue-500/10 text-blue-500'
      default: return 'bg-yellow-500/10 text-yellow-500'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'ongoing': return '连载中'
      case 'completed': return '已完结'
      default: return '草稿'
    }
  }

  // Smart Generation Functions
  const handleGenerateOutline = async () => {
    if (!smartGenNovel?.description) {
      toast({ title: '请先填写小说简介', variant: 'destructive' })
      return
    }
    
    setIsGeneratingOutline(true)
    setGeneratedOutline(null)
    
    // 计算预估时间（每批30章约需5-8秒）
    const estimatedBatches = Math.ceil(smartGenSettings.chapterCount / 30)
    const estimatedSeconds = estimatedBatches * 8 + 5
    
    try {
      // 使用 AbortController 设置较长的超时时间（5分钟）
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000)
      
      const res = await fetch('/api/ai/generate-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: smartGenNovel.title,
          description: smartGenNovel.description,
          genre: smartGenNovel.genre,
          totalWords: smartGenSettings.totalWords,
          chapterCount: smartGenSettings.chapterCount
        }),
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      const data = await res.json()
      if (data.success) {
        setGeneratedOutline(data.outline)
        toast({ title: '大纲生成成功！' })
      } else {
        toast({ title: data.error || '生成大纲失败', variant: 'destructive' })
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        toast({ title: '请求超时，请减少章节数量后重试', variant: 'destructive' })
      } else {
        toast({ title: '生成大纲失败', variant: 'destructive' })
      }
    }
    setIsGeneratingOutline(false)
  }

  const handleGenerateAllChapters = async () => {
    if (!generatedOutline || !smartGenNovel) return
    
    setIsGeneratingChapters(true)
    setGenerationProgress({ current: 0, total: generatedOutline.chapters.length, currentTitle: '' })
    
    const storyContext = `小说标题：${smartGenNovel.title}
类型：${smartGenNovel.genre || '未分类'}
开头概述：${generatedOutline.beginning}
经过概述：${generatedOutline.middle}
结尾概述：${generatedOutline.ending}`
    
    let previousContent = ''
    const createdChapters: Chapter[] = []
    const failedChapters: number[] = []
    
    try {
      for (let i = 0; i < generatedOutline.chapters.length; i++) {
        const chapterInfo = generatedOutline.chapters[i]
        setGenerationProgress({ 
          current: i + 1, 
          total: generatedOutline.chapters.length, 
          currentTitle: chapterInfo.title 
        })
        
        // Create chapter first
        const createRes = await fetch('/api/chapters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            novelId: smartGenNovel.id,
            title: chapterInfo.title,
            order: i
          })
        })
        const createData = await createRes.json()
        
        if (!createData.success) {
          console.error(`创建章节失败: ${chapterInfo.title}`)
          failedChapters.push(i)
          continue
        }
        
        const newChapterData = createData.chapter
        
        // Generate chapter content
        const genRes = await fetch('/api/ai/generate-chapter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            novelId: smartGenNovel.id,
            chapterIndex: i,
            chapterTitle: chapterInfo.title,
            chapterOutline: chapterInfo.outline,
            previousContent: previousContent.slice(-500),
            storyContext
          })
        })
        const genData = await genRes.json()
        
        if (genData.success) {
          // Update chapter content
          await fetch('/api/chapters', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: newChapterData.id,
              content: genData.content,
              wordCount: genData.wordCount
            })
          })
          
          previousContent = genData.content
          createdChapters.push({
            ...newChapterData,
            content: genData.content,
            wordCount: genData.wordCount
          })
        } else {
          console.error(`生成章节内容失败: ${chapterInfo.title}`, genData.error)
          failedChapters.push(i)
          // 继续下一章，不中断整个流程
        }
        
        // 每生成3章后暂停一下，避免速率限制
        if ((i + 1) % 3 === 0 && i < generatedOutline.chapters.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }
      
      // Update local state
      const updatedNovel = { 
        ...smartGenNovel, 
        chapters: createdChapters,
        wordCount: createdChapters.reduce((sum, ch) => sum + ch.wordCount, 0)
      }
      setNovels(novels.map(n => n.id === smartGenNovel.id ? updatedNovel : n))
      
      if (failedChapters.length > 0) {
        toast({ 
          title: `成功生成 ${createdChapters.length} 章，${failedChapters.length} 章失败`, 
          variant: 'destructive' 
        })
      } else {
        toast({ title: `成功生成 ${createdChapters.length} 个章节！` })
      }
      setShowSmartGenerate(false)
      setGeneratedOutline(null)
      setSmartGenNovel(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成章节失败'
      toast({ title: message, variant: 'destructive' })
    }
    setIsGeneratingChapters(false)
  }

  // Chapter List Component (reusable)
  const ChapterListComponent = ({ inSheet = false }: { inSheet?: boolean }) => (
    <div className={inSheet ? 'py-2' : ''}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">{inSheet ? '章节目录' : ''}</h3>
        <Dialog open={isCreatingChapter} onOpenChange={setIsCreatingChapter}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1">
              <Plus className="w-4 h-4" />
              新建
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>新建章节</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="chapter-title">章节标题</Label>
                <Input
                  id="chapter-title"
                  placeholder="例如：第一章 初入江湖"
                  value={newChapter.title}
                  onChange={(e) => setNewChapter({ ...newChapter, title: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreatingChapter(false)}>取消</Button>
              <Button onClick={handleCreateChapter} disabled={isLoading}>
                {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                创建
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <ScrollArea className={inSheet ? 'h-[60vh]' : 'h-[calc(100%-60px)]'}>
        <div className={inSheet ? 'space-y-1' : 'px-2 pb-2'}>
          {[...currentNovel?.chapters || []]
            .sort((a, b) => a.order - b.order)
            .map((chapter) => (
            <div
              key={chapter.id}
              className={`group flex items-center gap-2 px-3 py-3 rounded-lg cursor-pointer transition-colors touch-manipulation ${
                currentChapter?.id === chapter.id
                  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                  : 'hover:bg-muted active:bg-muted'
              }`}
              onClick={() => selectChapter(chapter)}
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate text-sm">{chapter.title}</span>
              <span className="text-xs text-muted-foreground">{chapter.wordCount}字</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 touch-manipulation"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteChapter(chapter.id)
                }}
              >
                <Trash2 className="w-4 h-4 text-red-500" />
              </Button>
            </div>
          ))}
          {currentNovel?.chapters.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              暂无章节<br />点击上方新建
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          {viewMode === 'list' ? (
            <>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                  <PenTool className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">
                    小说创作助手
                  </h1>
                  {!isMobile && <p className="text-xs text-muted-foreground">AI智能写作伙伴</p>}
                </div>
              </div>
              <Button 
                className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700"
                onClick={() => setIsCreatingNovel(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                {!isMobile && '创建'}
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                {isMobile && (
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => {
                      stopTTS()
                      setViewMode('list')
                      setCurrentNovel(null)
                      setCurrentChapter(null)
                    }}
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </Button>
                )}
                <div className="flex-1 min-w-0">
                  <h1 className="font-semibold truncate">{currentNovel?.title}</h1>
                  <p className="text-xs text-muted-foreground truncate">
                    {currentChapter?.title || '未选择章节'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!isMobile && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                      stopTTS()
                      setViewMode('list')
                      setCurrentNovel(null)
                      setCurrentChapter(null)
                    }}
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    返回
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-4 md:py-6">
        {/* Novel List View */}
        {viewMode === 'list' && (
          <div className="space-y-4 md:space-y-6">
            {/* Create Novel Dialog */}
            <Dialog open={isCreatingNovel} onOpenChange={setIsCreatingNovel}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>创建新小说</DialogTitle>
                  <DialogDescription>
                    填写基本信息，开始你的创作之旅
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">小说标题 *</Label>
                    <Input
                      id="title"
                      placeholder="输入小说标题"
                      value={newNovel.title}
                      onChange={(e) => setNewNovel({ ...newNovel, title: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="genre">类型</Label>
                    <Select value={newNovel.genre} onValueChange={(value) => setNewNovel({ ...newNovel, genre: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择小说类型" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fantasy">玄幻</SelectItem>
                        <SelectItem value="urban">都市</SelectItem>
                        <SelectItem value="scifi">科幻</SelectItem>
                        <SelectItem value="romance">言情</SelectItem>
                        <SelectItem value="wuxia">武侠</SelectItem>
                        <SelectItem value="history">历史</SelectItem>
                        <SelectItem value="suspense">悬疑</SelectItem>
                        <SelectItem value="other">其他</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">简介（20字以上可启用智能生成）</Label>
                    <Textarea
                      id="description"
                      placeholder="详细描述你的故事背景、主要人物、情节发展..."
                      value={newNovel.description}
                      onChange={(e) => setNewNovel({ ...newNovel, description: e.target.value })}
                      rows={4}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreatingNovel(false)}>取消</Button>
                  <Button onClick={handleCreateNovel} disabled={isLoading}>
                    {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    创建
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Smart Generate Dialog */}
            <Dialog open={showSmartGenerate} onOpenChange={setShowSmartGenerate}>
              <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Wand2 className="w-5 h-5 text-amber-500" />
                    智能生成章节
                  </DialogTitle>
                  <DialogDescription>
                    根据小说简介自动分析故事结构，生成章节大纲和丰富内容
                  </DialogDescription>
                </DialogHeader>
                
                <div className="flex-1 overflow-y-auto space-y-4 py-4">
                  {/* Novel Info */}
                  {smartGenNovel && (
                    <Card>
                      <CardContent className="py-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="secondary">{smartGenNovel.genre || '未分类'}</Badge>
                          <span className="font-semibold">{smartGenNovel.title}</span>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {smartGenNovel.description}
                        </p>
                      </CardContent>
                    </Card>
                  )}
                  
                  {/* Settings */}
                  {!generatedOutline && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>计划总字数</Label>
                        <Select 
                          value={smartGenSettings.totalWords.toString()} 
                          onValueChange={(v) => setSmartGenSettings({ ...smartGenSettings, totalWords: parseInt(v) })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="5000">5,000 字</SelectItem>
                            <SelectItem value="10000">10,000 字</SelectItem>
                            <SelectItem value="30000">30,000 字</SelectItem>
                            <SelectItem value="50000">50,000 字</SelectItem>
                            <SelectItem value="100000">100,000 字</SelectItem>
                            <SelectItem value="200000">200,000 字</SelectItem>
                            <SelectItem value="500000">500,000 字</SelectItem>
                            <SelectItem value="1000000">1,000,000 字</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>章节数量</Label>
                        <Select 
                          value={smartGenSettings.chapterCount.toString()} 
                          onValueChange={(v) => setSmartGenSettings({ ...smartGenSettings, chapterCount: parseInt(v) })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="5">5 章</SelectItem>
                            <SelectItem value="10">10 章</SelectItem>
                            <SelectItem value="20">20 章</SelectItem>
                            <SelectItem value="30">30 章</SelectItem>
                            <SelectItem value="50">50 章</SelectItem>
                            <SelectItem value="100">100 章</SelectItem>
                            <SelectItem value="200">200 章</SelectItem>
                            <SelectItem value="300">300 章</SelectItem>
                            <SelectItem value="500">500 章</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                  
                  {/* Generate Outline Button */}
                  {!generatedOutline && (
                    <div className="space-y-3">
                      {smartGenSettings.chapterCount > 50 && (
                        <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg text-sm">
                          <AlertCircle className="w-4 h-4 text-amber-500" />
                          <span className="text-amber-700 dark:text-amber-300">
                            {smartGenSettings.chapterCount}章预计需要约{Math.ceil(smartGenSettings.chapterCount / 30) * 8 + 5}秒，请耐心等待
                          </span>
                        </div>
                      )}
                      <Button 
                        onClick={handleGenerateOutline} 
                        disabled={isGeneratingOutline}
                        className="w-full"
                      >
                        {isGeneratingOutline ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            正在生成大纲（{smartGenSettings.chapterCount}章）...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4 mr-2" />
                            生成章节大纲
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                  
                  {/* Generated Outline Preview */}
                  {generatedOutline && (
                    <div className="space-y-4">
                      {/* Story Analysis */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20">
                          <CardHeader className="pb-2 pt-3 px-3">
                            <CardTitle className="text-sm flex items-center gap-1">
                              <BookOpen className="w-4 h-4 text-green-500" />
                              开头
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="pb-3 px-3">
                            <p className="text-xs text-muted-foreground">{generatedOutline.beginning}</p>
                          </CardContent>
                        </Card>
                        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
                          <CardHeader className="pb-2 pt-3 px-3">
                            <CardTitle className="text-sm flex items-center gap-1">
                              <Edit3 className="w-4 h-4 text-amber-500" />
                              经过
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="pb-3 px-3">
                            <p className="text-xs text-muted-foreground">{generatedOutline.middle}</p>
                          </CardContent>
                        </Card>
                        <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
                          <CardHeader className="pb-2 pt-3 px-3">
                            <CardTitle className="text-sm flex items-center gap-1">
                              <BookMarked className="w-4 h-4 text-blue-500" />
                              结尾
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="pb-3 px-3">
                            <p className="text-xs text-muted-foreground">{generatedOutline.ending}</p>
                          </CardContent>
                        </Card>
                      </div>
                      
                      {/* Chapter List */}
                      <div>
                        <h4 className="font-medium mb-2 flex items-center gap-2">
                          <List className="w-4 h-4" />
                          章节大纲 ({generatedOutline.chapters.length}章)
                        </h4>
                        <ScrollArea className="h-[200px] rounded border p-2">
                          <div className="space-y-2">
                            {generatedOutline.chapters.map((chapter, index) => (
                              <div key={index} className="flex gap-3 p-2 rounded hover:bg-muted/50">
                                <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                                  <span className="text-xs font-medium text-amber-600">{index + 1}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm">{chapter.title}</p>
                                  <p className="text-xs text-muted-foreground line-clamp-1">{chapter.outline}</p>
                                </div>
                                <Badge variant="outline" className="shrink-0">
                                  {chapter.estimatedWords}字
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                      
                      {/* Generation Progress */}
                      {isGeneratingChapters && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span>正在生成: {generationProgress.currentTitle}</span>
                            <span>{generationProgress.current} / {generationProgress.total}</span>
                          </div>
                          <Progress value={(generationProgress.current / generationProgress.total) * 100} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                <DialogFooter className="flex-col sm:flex-row gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setShowSmartGenerate(false)
                      setGeneratedOutline(null)
                      setSmartGenNovel(null)
                    }}
                    disabled={isGeneratingChapters}
                  >
                    取消
                  </Button>
                  {generatedOutline && (
                    <Button 
                      onClick={handleGenerateAllChapters}
                      disabled={isGeneratingChapters}
                      className="bg-gradient-to-r from-amber-500 to-orange-600"
                    >
                      {isGeneratingChapters ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          正在生成章节内容...
                        </>
                      ) : (
                        <>
                          <Wand2 className="w-4 h-4 mr-2" />
                          确认并生成全部章节
                        </>
                      )}
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {novels.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 md:py-16">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <BookOpen className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium mb-2">还没有作品</h3>
                  <p className="text-muted-foreground text-center mb-4">
                    点击右上方按钮创建你的第一部小说
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                {novels.map((novel) => (
                  <Card 
                    key={novel.id} 
                    className="group cursor-pointer hover:shadow-lg transition-all duration-300 hover:-translate-y-1 touch-manipulation"
                    onClick={() => openNovelEditor(novel)}
                  >
                    <CardHeader className="pb-2 md:pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-base md:text-lg line-clamp-1">{novel.title}</CardTitle>
                          <CardDescription className="line-clamp-2 mt-1 text-xs md:text-sm">
                            {novel.description || '暂无简介'}
                          </CardDescription>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-8 w-8 touch-manipulation">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem 
                              onClick={(e) => {
                                e.stopPropagation()
                                setSmartGenNovel(novel)
                                setShowSmartGenerate(true)
                              }}
                            >
                              <Wand2 className="w-4 h-4 mr-2 text-amber-500" />
                              智能生成章节
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={(e) => {
                                e.stopPropagation()
                                handleUpdateNovelStatus(novel.id, 'ongoing')
                              }}
                            >
                              <Badge className="bg-green-500/10 text-green-500 text-[10px] mr-2">连载</Badge>
                              标记为连载中
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={(e) => {
                                e.stopPropagation()
                                handleUpdateNovelStatus(novel.id, 'completed')
                              }}
                            >
                              <Badge className="bg-blue-500/10 text-blue-500 text-[10px] mr-2">完结</Badge>
                              标记为已完结
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={(e) => {
                                e.stopPropagation()
                                handleUpdateNovelStatus(novel.id, 'draft')
                              }}
                            >
                              <Badge className="bg-yellow-500/10 text-yellow-500 text-[10px] mr-2">草稿</Badge>
                              标记为草稿
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              className="text-red-600"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteNovel(novel.id)
                              }}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>
                    <CardContent className="pb-3 md:pb-4">
                      <div className="flex items-center gap-2 mb-2 md:mb-3 flex-wrap">
                        {novel.genre && (
                          <Badge variant="secondary" className="text-xs">
                            {novel.genre}
                          </Badge>
                        )}
                        <Badge className={`${getStatusBadge(novel.status)} text-xs`}>
                          {getStatusText(novel.status)}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-xs md:text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3 md:w-4 md:h-4" />
                          {novel.chapters.length} 章
                        </span>
                        <span className="flex items-center gap-1">
                          <PenTool className="w-3 h-3 md:w-4 md:h-4" />
                          {novel.wordCount.toLocaleString()} 字
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Editor View */}
        {viewMode === 'editor' && currentNovel && (
          <div className="flex gap-4 h-[calc(100vh-180px)] md:h-[calc(100vh-140px)]">
            {/* Desktop Sidebar - Chapter List */}
            <div className="w-64 shrink-0 hidden md:block">
              <Card className="h-full">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">章节目录</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ChapterListComponent />
                </CardContent>
              </Card>
            </div>

            {/* Main Editor */}
            <div className="flex-1 flex flex-col min-w-0">
              {currentChapter ? (
                <>
                  {/* Mobile Chapter Header */}
                  {isMobile && (
                    <div className="flex items-center justify-between mb-3 pb-3 border-b">
                      <Sheet open={showChapterSheet} onOpenChange={setShowChapterSheet}>
                        <SheetTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-2">
                            <List className="w-4 h-4" />
                            <span className="truncate max-w-[150px]">{currentChapter.title}</span>
                          </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="w-[280px]">
                          <SheetHeader>
                            <SheetTitle>{currentNovel.title}</SheetTitle>
                          </SheetHeader>
                          <ChapterListComponent inSheet />
                        </SheetContent>
                      </Sheet>
                      <div className="flex items-center gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon"
                          className="h-9 w-9 touch-manipulation"
                          onClick={() => navigateChapter('prev')}
                          disabled={currentNovel.chapters.sort((a, b) => a.order - b.order).findIndex(ch => ch.id === currentChapter.id) === 0}
                        >
                          <ChevronLeft className="w-5 h-5" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          className="h-9 w-9 touch-manipulation"
                          onClick={() => navigateChapter('next')}
                          disabled={currentNovel.chapters.sort((a, b) => a.order - b.order).findIndex(ch => ch.id === currentChapter.id) === currentNovel.chapters.length - 1}
                        >
                          <ChevronRight className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Desktop Chapter Header */}
                  {!isMobile && (
                    <div className="flex items-center justify-between mb-4">
                      <Input
                        value={currentChapter.title}
                        className="text-xl font-semibold border-none shadow-none focus-visible:ring-0 px-0"
                        onChange={async (e) => {
                          const newTitle = e.target.value
                          const updatedChapter = { ...currentChapter, title: newTitle }
                          setCurrentChapter(updatedChapter)
                          if (currentNovel) {
                            const updatedChapters = currentNovel.chapters.map(ch => 
                              ch.id === currentChapter.id ? updatedChapter : ch
                            )
                            setCurrentNovel({ ...currentNovel, chapters: updatedChapters })
                          }
                        }}
                        onBlur={async () => {
                          if (currentChapter) {
                            await fetch('/api/chapters', {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                id: currentChapter.id,
                                title: currentChapter.title
                              })
                            })
                          }
                        }}
                      />
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{editingContent.length.toLocaleString()} 字</span>
                      </div>
                    </div>
                  )}

                  {/* Editor Tabs */}
                  <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                    <TabsList className="w-full justify-start">
                      <TabsTrigger value="write" className="gap-1 md:gap-2 text-xs md:text-sm">
                        <Edit3 className="w-3 h-3 md:w-4 md:h-4" />
                        写作
                      </TabsTrigger>
                      <TabsTrigger value="ai" className="gap-1 md:gap-2 text-xs md:text-sm">
                        <Sparkles className="w-3 h-3 md:w-4 md:h-4" />
                        AI助手
                      </TabsTrigger>
                      <TabsTrigger value="tts" className="gap-1 md:gap-2 text-xs md:text-sm">
                        <Volume2 className="w-3 h-3 md:w-4 md:h-4" />
                        语音
                      </TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="write" className="flex-1 mt-3 md:mt-4">
                      <Textarea
                        placeholder="开始你的创作..."
                        className="h-full resize-none text-base leading-relaxed"
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                      />
                    </TabsContent>
                    
                    <TabsContent value="ai" className="flex-1 mt-3 md:mt-4 space-y-3 md:space-y-4 overflow-y-auto">
                      <div className="grid grid-cols-2 gap-2 md:gap-3">
                        <Button 
                          variant="outline" 
                          className="h-auto py-3 md:py-4 flex flex-col gap-1 touch-manipulation"
                          onClick={handleAIContinue}
                          disabled={isAILoading}
                        >
                          {isAILoading ? (
                            <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-amber-500" />
                          )}
                          <span className="text-xs md:text-sm">AI续写</span>
                          <span className="text-[10px] md:text-xs text-muted-foreground hidden md:block">根据上下文继续创作</span>
                        </Button>
                        <Button 
                          variant="outline" 
                          className="h-auto py-3 md:py-4 flex flex-col gap-1 touch-manipulation"
                          onClick={handleAITitle}
                          disabled={isAILoading}
                        >
                          {isAILoading ? (
                            <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                          ) : (
                            <FileText className="w-4 h-4 md:w-5 md:h-5 text-blue-500" />
                          )}
                          <span className="text-xs md:text-sm">生成标题</span>
                          <span className="text-[10px] md:text-xs text-muted-foreground hidden md:block">根据内容生成章节标题</span>
                        </Button>
                      </div>
                      
                      {aiSuggestion && (
                        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/30">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <Sparkles className="w-4 h-4 text-amber-500" />
                              AI建议
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm whitespace-pre-wrap mb-3">{aiSuggestion}</p>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={applySuggestion}>
                                采用建议
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setAiSuggestion('')}>
                                忽略
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </TabsContent>

                    <TabsContent value="tts" className="flex-1 mt-3 md:mt-4 overflow-y-auto">
                      <TTSPlayer content={editingContent} disabled={!editingContent.trim()} />
                    </TabsContent>
                  </Tabs>

                  {/* Desktop Chapter Navigation */}
                  {!isMobile && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => navigateChapter('prev')}
                        disabled={currentNovel.chapters.sort((a, b) => a.order - b.order).findIndex(ch => ch.id === currentChapter.id) === 0}
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        上一章
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => navigateChapter('next')}
                        disabled={currentNovel.chapters.sort((a, b) => a.order - b.order).findIndex(ch => ch.id === currentChapter.id) === currentNovel.chapters.length - 1}
                      >
                        下一章
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <Card className="border-dashed max-w-md">
                    <CardContent className="flex flex-col items-center py-8 md:py-12">
                      <FileText className="w-10 h-10 md:w-12 md:h-12 text-muted-foreground mb-4" />
                      <h3 className="text-base md:text-lg font-medium mb-2">选择或创建章节</h3>
                      <p className="text-muted-foreground text-center mb-4 text-sm">
                        从目录选择章节，或创建新章节
                      </p>
                      <div className="flex gap-2">
                        <Button onClick={() => setIsCreatingChapter(true)} className="touch-manipulation">
                          <Plus className="w-4 h-4 mr-2" />
                          创建章节
                        </Button>
                        {currentNovel?.description && currentNovel.description.length >= 20 && (
                          <Button 
                            variant="outline"
                            onClick={() => {
                              setSmartGenNovel(currentNovel)
                              setShowSmartGenerate(true)
                            }}
                          >
                            <Wand2 className="w-4 h-4 mr-2" />
                            智能生成
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      {isMobile && viewMode === 'editor' && currentNovel && currentChapter && (
        <div className="fixed bottom-0 left-0 right-0 border-t bg-white dark:bg-slate-900 pb-safe z-50">
          <div className="flex items-center justify-around py-2">
            <Button 
              variant="ghost" 
              className="flex-col gap-1 h-auto py-2 px-4 touch-manipulation"
              onClick={() => setActiveTab('write')}
            >
              <Edit3 className={`w-5 h-5 ${activeTab === 'write' ? 'text-amber-500' : ''}`} />
              <span className={`text-[10px] ${activeTab === 'write' ? 'text-amber-500 font-medium' : 'text-muted-foreground'}`}>写作</span>
            </Button>
            <Button 
              variant="ghost" 
              className="flex-col gap-1 h-auto py-2 px-4 touch-manipulation"
              onClick={() => setActiveTab('ai')}
            >
              <Sparkles className={`w-5 h-5 ${activeTab === 'ai' ? 'text-amber-500' : ''}`} />
              <span className={`text-[10px] ${activeTab === 'ai' ? 'text-amber-500 font-medium' : 'text-muted-foreground'}`}>AI助手</span>
            </Button>
            <Button 
              variant="ghost" 
              className="flex-col gap-1 h-auto py-2 px-4 touch-manipulation"
              onClick={() => setActiveTab('tts')}
            >
              <Volume2 className={`w-5 h-5 ${activeTab === 'tts' ? 'text-amber-500' : ''}`} />
              <span className={`text-[10px] ${activeTab === 'tts' ? 'text-amber-500 font-medium' : 'text-muted-foreground'}`}>语音</span>
            </Button>
            <Sheet open={showChapterSheet} onOpenChange={setShowChapterSheet}>
              <SheetTrigger asChild>
                <Button variant="ghost" className="flex-col gap-1 h-auto py-2 px-4 touch-manipulation">
                  <List className="w-5 h-5" />
                  <span className="text-[10px] text-muted-foreground">目录</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px]">
                <SheetHeader>
                  <SheetTitle>{currentNovel.title}</SheetTitle>
                </SheetHeader>
                <ChapterListComponent inSheet />
              </SheetContent>
            </Sheet>
          </div>
        </div>
      )}

      {/* Footer - Desktop only */}
      {!isMobile && (
        <footer className="mt-auto border-t py-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
          <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
            小说创作助手 - AI智能写作伙伴 | 自动保存已开启
          </div>
        </footer>
      )}

      <Toaster />
    </div>
  )
}
