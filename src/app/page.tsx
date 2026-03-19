'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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
  const [aiMode, setAiMode] = useState<'continue' | 'polish' | 'shorten' | 'expand'>('continue')
  const [aiVariants, setAiVariants] = useState<1 | 3 | 5>(1)
  const [aiCandidates, setAiCandidates] = useState<string[]>([])
  const [diffCandidateIndex, setDiffCandidateIndex] = useState<number | null>(null)
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  
  // Outline states (P2-1)
  const [storyOutline, setStoryOutline] = useState<StoryOutline | null>(null)
  const [showOutlinePanel, setShowOutlinePanel] = useState(false)
  const [editingOutlineChapter, setEditingOutlineChapter] = useState<number | null>(null)
  const [batchGenerating, setBatchGenerating] = useState(false)
  
  // Revision history states (P2-2)
  const [chapterRevisions, setChapterRevisions] = useState<Array<{id: string, content: string, wordCount: number, source: string, createdAt: string}>>([])
  const [showRevisions, setShowRevisions] = useState(false)
  const [loadingRevisions, setLoadingRevisions] = useState(false)
  
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
  const [smartGenSettings, setSmartGenSettings] = useState({ 
    totalWords: 100000, 
    chapterCount: 20,
    generateMode: 'full' as 'full' | 'opening'
  })
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState({
    phase: '',
    message: '',
    current: 0,
    total: 0,
    currentTitle: '',
    totalWords: 0,
    progress: 0,
    structure: null as { beginning: string; middle: string; ending: string } | null
  })
  
  // Edit novel states
  const [isEditingNovel, setIsEditingNovel] = useState(false)
  const [editingNovel, setEditingNovel] = useState<Novel | null>(null)
  const [editNovelData, setEditNovelData] = useState({ title: '', description: '', genre: '' })
  
  const { toast } = useToast()

  // Detect mobile
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Fetch novels - load local data immediately, then sync OSS in background
  useEffect(() => {
    let isMounted = true
    const fetchNovels = async () => {
      try {
        // 第一步：立即加载本地数据库中的小说列表，快速展示给用户
        const res = await fetch('/api/novels')
        const data = await res.json()
        if (data.success && isMounted) {
          setNovels(data.novels)
        }
      } catch (error) {
        console.error('Failed to fetch novels:', error)
      }

      // 第二步：后台异步执行 OSS 同步，不阻塞页面渲染
      fetch('/api/oss/sync')
        .then(r => r.json())
        .then(syncData => {
          if (!isMounted) return
          if (syncData.success && syncData.syncedCount > 0) {
            console.log(`从OSS同步了 ${syncData.syncedCount} 本小说，刷新列表`)
            // 同步完成后刷新小说列表
            fetch('/api/novels')
              .then(r => r.json())
              .then(d => { if (d.success && isMounted) setNovels(d.novels) })
              .catch(() => {})
          }
        })
        .catch(syncError => console.log('OSS同步跳过:', syncError))
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

  // Save chapter content - must be defined before auto-save useEffect
  const saveChapterContent = useCallback(async (content: string) => {
    if (!currentChapter) return
    
    const wordCount = content.length
    try {
      const res = await fetch('/api/chapters', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentChapter.id,
          content,
          wordCount
        })
      })
      const data = await res.json()
      if (data.success) {
        if (currentNovel) {
          const updatedChapters = currentNovel.chapters.map(ch => 
            ch.id === currentChapter.id ? { ...ch, content, wordCount } : ch
          )
          setCurrentNovel({ ...currentNovel, chapters: updatedChapters })
        }
        setCurrentChapter({ ...currentChapter, content, wordCount })
      }
    } catch (error) {
      console.error('Auto-save failed:', error)
    }
  }, [currentChapter, currentNovel])

  // Auto-save content
  useEffect(() => {
    if (!currentChapter || !editingContent) return
    
    const timer = setTimeout(() => {
      saveChapterContent(editingContent)
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

  // Open edit novel dialog
  const openEditNovelDialog = (novel: Novel) => {
    setEditingNovel(novel)
    setEditNovelData({
      title: novel.title,
      description: novel.description || '',
      genre: novel.genre || ''
    })
    setIsEditingNovel(true)
  }

  // Handle edit novel
  const handleEditNovel = async () => {
    if (!editingNovel || !editNovelData.title.trim()) {
      toast({ title: '请输入小说标题', variant: 'destructive' })
      return
    }
    
    setIsLoading(true)
    try {
      const res = await fetch('/api/novels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingNovel.id,
          title: editNovelData.title,
          description: editNovelData.description,
          genre: editNovelData.genre
        })
      })
      const data = await res.json()
      if (data.success) {
        setNovels(novels.map(n => n.id === editingNovel.id ? {
          ...n,
          title: editNovelData.title,
          description: editNovelData.description,
          genre: editNovelData.genre
        } : n))
        setIsEditingNovel(false)
        setEditingNovel(null)
        toast({ title: '小说信息已更新' })
      }
    } catch (error) {
      toast({ title: '更新失败', variant: 'destructive' })
    }
    setIsLoading(false)
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
    setAiCandidates([])
    setAiMode('continue')
    
    try {
      const res = await fetch('/api/ai/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'continue',
          input: { scope: 'chapter', text: editingContent },
          options: { variants: aiVariants, length: aiVariants === 1 ? '100' : '300' }
        })
      })
      const data = await res.json()
      if (data.success) {
        const candidates = (data.candidates || []).map((c: { text: string }) => c.text).filter(Boolean)
        if (candidates.length <= 1) setAiSuggestion(candidates[0] || '')
        else setAiCandidates(candidates)
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
    setAiMode('continue')
    
    try {
      const res = await fetch('/api/ai/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'title', input: { scope: 'chapter', text: editingContent }, options: { variants: 1 } })
      })
      const data = await res.json()
      let title = data?.candidates?.[0]?.text?.trim()
      if (data.success && currentChapter && title) {
        // 保留原有的章节号前缀（如"第X章"）
        const originalTitle = currentChapter.title
        const chapterPrefixMatch = originalTitle.match(/^(第[一二三四五六七八九十百千\d]+章\s*)/)
        if (chapterPrefixMatch) {
          // 移除新标题中可能已有的章节号前缀
          const cleanTitle = title.replace(/^(第[一二三四五六七八九十百千\d]+章\s*)/, '')
          title = chapterPrefixMatch[1] + cleanTitle
        }
        
        const res2 = await fetch('/api/chapters', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: currentChapter.id,
            title
          })
        })
        const data2 = await res2.json()
        if (data2.success) {
          const updatedChapter = { ...currentChapter, title }
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
  // Save revision history (P2-2)
  const saveRevision = async (source: string, metadata?: Record<string, unknown>) => {
    if (!currentChapter) return
    try {
      await fetch('/api/chapters/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterId: currentChapter.id,
          content: editingContent,
          wordCount: editingContent.length,
          source,
          metadata,
        }),
      })
    } catch (error) {
      console.error('Save revision failed:', error)
    }
  }

  const applySuggestion = () => {
    if (!aiSuggestion || !currentChapter) return
    // Save current content as revision before applying
    saveRevision('ai_apply', { action: 'apply_suggestion' })
    setEditingContent(aiSuggestion)
    setAiSuggestion('')
  }

  const applyCandidate = (text: string, mode: 'replace' | 'insert', source: string = 'ai_candidate') => {
    if (!currentChapter) return
    const range = selectionRange
    // Save current content as revision before applying
    saveRevision(source, { mode, hasSelection: !!range && range.start !== range.end })
    
    if (!range || range.start === range.end) {
      if (mode === 'insert') {
        setEditingContent((prev) => prev + (prev ? '\n\n' : '') + text)
      } else {
        setEditingContent(text)
      }
      return
    }
    setEditingContent((prev) => {
      const before = prev.slice(0, range.start)
      const after = prev.slice(range.end)
      const next = mode === 'insert' ? before + text + after : before + text + after
      return next
    })
  }

  const handleAIRefine = async (mode: 'polish' | 'shorten' | 'expand') => {
    const raw = editingContent
    const range = selectionRange
    const hasSelection = !!range && range.start !== range.end
    const text = hasSelection ? raw.slice(range!.start, range!.end).trim() : raw.trim()

    if (!text) {
      toast({ title: hasSelection ? '请先选中一些内容' : '请先输入一些内容', variant: 'destructive' })
      return
    }

    setIsAILoading(true)
    setAiMode(mode)
    setAiSuggestion('')
    setAiCandidates([])
    try {
      const res = await fetch('/api/ai/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rewrite',
          input: { scope: hasSelection ? 'selection' : 'chapter', text },
          options: { mode, variants: aiVariants },
        }),
      })
      const data = await res.json()
      if (!data.success) {
        toast({ title: data.error || 'AI 优化失败', variant: 'destructive' })
        return
      }
      const candidates = (data.candidates || []).map((c: { text: string }) => c.text).filter(Boolean)
      if (candidates.length <= 1) {
        setAiSuggestion(candidates[0] || '')
      } else {
        setAiCandidates(candidates)
      }
    } catch (error) {
      console.error('AI action error:', error)
      toast({ title: 'AI 优化失败', variant: 'destructive' })
    }
    setIsAILoading(false)
  }

  const handleAIDescribe = async (subAction: 'environment' | 'emotion' | 'action' | 'dialogue') => {
    const raw = editingContent
    const range = selectionRange
    const hasSelection = !!range && range.start !== range.end
    const text = hasSelection ? raw.slice(range!.start, range!.end).trim() : raw.trim()

    if (!text) {
      toast({ title: hasSelection ? '请先选中一些内容' : '请先输入一些内容', variant: 'destructive' })
      return
    }

    setIsAILoading(true)
    setAiMode('continue')
    setAiSuggestion('')
    setAiCandidates([])
    try {
      const res = await fetch('/api/ai/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'describe',
          input: { scope: hasSelection ? 'selection' : 'chapter', text },
          options: { subAction, variants: aiVariants, length: aiVariants === 1 ? '100' : '300' },
        }),
      })
      const data = await res.json()
      if (!data.success) {
        toast({ title: data.error || 'AI 优化失败', variant: 'destructive' })
        return
      }
      const candidates = (data.candidates || []).map((c: { text: string }) => c.text).filter(Boolean)
      if (candidates.length <= 1) {
        setAiSuggestion(candidates[0] || '')
      } else {
        setAiCandidates(candidates)
      }
    } catch (error) {
      console.error('AI describe error:', error)
      toast({ title: 'AI 描写增强失败', variant: 'destructive' })
    }
    setIsAILoading(false)
  }

  // Get original text for diff (selection or full chapter)
  const getDiffOriginalText = useCallback(() => {
    const range = selectionRange
    const hasSelection = !!range && range.start !== range.end
    if (hasSelection) {
      return editingContent.slice(range!.start, range!.end)
    }
    return editingContent
  }, [editingContent, selectionRange])

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

  // Outline Functions (P2-1)
  const generateOutline = async () => {
    if (!currentNovel) return
    setIsLoading(true)
    try {
      const res = await fetch('/api/ai/generate-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: currentNovel.title,
          description: currentNovel.description || '',
          genre: currentNovel.genre,
          totalWords: 100000,
          chapterCount: 20
        })
      })
      const data = await res.json()
      if (data.success) {
        setStoryOutline(data.outline)
        setShowOutlinePanel(true)
        toast({ title: '大纲生成成功！' })
      } else {
        toast({ title: data.error || '生成大纲失败', variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: '生成大纲失败', variant: 'destructive' })
    }
    setIsLoading(false)
  }

  const updateOutlineChapter = (index: number, updates: Partial<ChapterOutline>) => {
    if (!storyOutline) return
    const newChapters = [...storyOutline.chapters]
    newChapters[index] = { ...newChapters[index], ...updates }
    setStoryOutline({ ...storyOutline, chapters: newChapters })
  }

  const generateChapterOpening = async (chapterIndex: number) => {
    if (!storyOutline || !currentNovel) return
    const chapter = storyOutline.chapters[chapterIndex]
    setIsAILoading(true)
    try {
      const res = await fetch('/api/ai/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'opening',
          novelId: currentNovel.id,
          input: { scope: 'chapter', text: `${chapter.title}\n${chapter.outline}` },
          options: { variants: 1, length: '100' }
        })
      })
      const data = await res.json()
      if (data.success && data.candidates?.[0]?.text) {
        // Create new chapter with the generated opening
        const res2 = await fetch('/api/chapters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            novelId: currentNovel.id,
            title: chapter.title,
            order: chapterIndex,
            content: data.candidates[0].text
          })
        })
        const data2 = await res2.json()
        if (data2.success) {
          const updatedNovel = { ...currentNovel, chapters: [...currentNovel.chapters, data2.chapter] }
          setCurrentNovel(updatedNovel)
          toast({ title: `第${chapterIndex + 1}章开头已生成` })
        }
      }
    } catch (error) {
      toast({ title: '生成开头失败', variant: 'destructive' })
    }
    setIsAILoading(false)
  }

  const batchGenerateOpenings = async () => {
    if (!storyOutline || !currentNovel) return
    setBatchGenerating(true)
    const chapters = storyOutline.chapters
    for (let i = 0; i < chapters.length; i++) {
      // Check if chapter already exists
      const exists = currentNovel.chapters.find(ch => ch.order === i)
      if (exists) continue
      
      await generateChapterOpening(i)
      // Delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    setBatchGenerating(false)
    toast({ title: '批量生成完成！' })
  }

  // Revision History Functions (P2-2)
  const loadChapterRevisions = async () => {
    if (!currentChapter) return
    setLoadingRevisions(true)
    try {
      const res = await fetch(`/api/chapters/revisions?chapterId=${currentChapter.id}`)
      const data = await res.json()
      if (data.success) {
        setChapterRevisions(data.revisions || [])
        setShowRevisions(true)
      }
    } catch (error) {
      console.error('Load revisions failed:', error)
    }
    setLoadingRevisions(false)
  }

  const restoreRevision = async (revisionId: string) => {
    try {
      const res = await fetch('/api/chapters/revisions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revisionId }),
      })
      const data = await res.json()
      if (data.success && data.chapter) {
        setEditingContent(data.chapter.content)
        toast({ title: '已恢复到历史版本' })
        // Refresh revisions
        loadChapterRevisions()
      } else {
        toast({ title: '恢复失败', variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: '恢复失败', variant: 'destructive' })
    }
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
  const selectChapter = async (chapter: Chapter) => {
    try {
      let fullChapter = chapter

      // 有些从目录或索引来的章节只有字数，没有正文，这里补一次拉取，避免出现「字数有、文本空白」
      if (!chapter.content && chapter.wordCount > 0) {
        const res = await fetch(`/api/chapters?id=${chapter.id}`)
        const data = await res.json()
        if (data.success && data.chapter) {
          fullChapter = data.chapter as Chapter
        }
      }

      setCurrentChapter(fullChapter)
      setEditingContent(fullChapter.content || '')
      setAiSuggestion('')
      setShowChapterSheet(false)
    } catch (error) {
      console.error('Select chapter error:', error)
      setCurrentChapter(chapter)
      setEditingContent(chapter.content || '')
      setAiSuggestion('')
      setShowChapterSheet(false)
    }
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

  // Smart Generation Functions - 流式生成
  const handleSmartGenerate = async () => {
    if (!smartGenNovel?.description || !smartGenNovel.description.trim()) {
      toast({ title: '请先填写小说简介', variant: 'destructive' })
      return
    }
    
    setIsGenerating(true)
    setGenerationProgress({
      phase: 'init',
      message: '正在初始化...',
      current: 0,
      total: smartGenSettings.chapterCount,
      currentTitle: '',
      totalWords: 0,
      progress: 0,
      structure: null
    })
    
    try {
      // 调用流式生成API
      const response = await fetch('/api/ai/stream-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
          novelId: smartGenNovel.id,
          title: smartGenNovel.title,
          description: smartGenNovel.description,
          genre: smartGenNovel.genre,
          totalWords: smartGenSettings.totalWords,
          chapterCount: smartGenSettings.chapterCount,
          generateMode: smartGenSettings.generateMode
        })
      })
      
      if (!response.ok) {
        throw new Error('请求失败')
      }
      
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('无法读取响应')
      }
      
      const decoder = new TextDecoder()
      let buffer = ''
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''
        
        for (const line of lines) {
          if (!line.trim()) continue
          
          // 解析SSE事件
          const eventMatch = line.match(/^event:\s*(\w+)\ndata:\s*(.+)$/s)
          if (eventMatch) {
            const [, event, dataStr] = eventMatch
            try {
              const data = JSON.parse(dataStr)
              
              switch (event) {
                case 'start':
                  setGenerationProgress(prev => ({
                    ...prev,
                    phase: 'structure',
                    message: data.message
                  }))
                  break
                  
                case 'structure':
                  setGenerationProgress(prev => ({
                    ...prev,
                    phase: 'outlines',
                    message: data.message,
                    structure: {
                      beginning: data.beginning,
                      middle: data.middle,
                      ending: data.ending
                    }
                  }))
                  break
                  
                case 'batch_start':
                  setGenerationProgress(prev => ({
                    ...prev,
                    phase: 'outlines',
                    message: data.message
                  }))
                  break
                  
                case 'outlines':
                  setGenerationProgress(prev => ({
                    ...prev,
                    phase: 'content',
                    message: data.message
                  }))
                  break
                  
                case 'chapter_start':
                  setGenerationProgress(prev => ({
                    ...prev,
                    phase: 'content',
                    current: data.index + 1,
                    currentTitle: data.title,
                    message: data.message
                  }))
                  break

                case 'existing':
                  toast({
                    title: data.message,
                    description: `将生成 ${data.toGenerateCount} 个新章节`
                  })
                  break

                case 'chapter_skip':
                  setGenerationProgress(prev => ({
                    ...prev,
                    current: data.index + 1,
                    currentTitle: data.title,
                    message: data.message
                  }))
                  break

                case 'chapter_done':
                  setGenerationProgress(prev => ({
                    ...prev,
                    current: data.index + 1,
                    totalWords: data.totalWords,
                    progress: parseFloat(data.progress),
                    message: `已完成 ${data.index + 1}/${prev.total} 章`
                  }))
                  break
                  
                case 'complete':
                  toast({ title: data.message })
                  // 刷新小说列表
                  const novelsRes = await fetch('/api/novels')
                  const novelsData = await novelsRes.json()
                  if (novelsData.success) {
                    setNovels(novelsData.novels)
                  }
                  setShowSmartGenerate(false)
                  setSmartGenNovel(null)
                  break
                  
                case 'error':
                  toast({ title: data.error, variant: 'destructive' })
                  break
              }
            } catch (e) {
              console.error('解析事件失败:', e)
            }
          }
        }
      }
    } catch (error) {
      toast({ 
        title: error instanceof Error ? error.message : '生成失败', 
        variant: 'destructive' 
      })
    }
    
    setIsGenerating(false)
  }

  // Chapter List Component (reusable). When hideHeaderRow, only list (desktop sidebar has 章节目录+新建 in CardHeader).
  const ChapterListComponent = ({ inSheet = false, hideHeaderRow = false }: { inSheet?: boolean; hideHeaderRow?: boolean }) => (
    <div className={inSheet ? 'py-2' : 'flex flex-col flex-1 min-h-0'}>
      {!hideHeaderRow && (
        <div className="flex items-center justify-between mb-3">
          {inSheet && <h3 className="font-semibold">章节目录</h3>}
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1">
              <Plus className="w-4 h-4" />
              新建
            </Button>
          </DialogTrigger>
        </div>
      )}
      {inSheet ? (
        <ScrollArea className="h-[60vh]">
          <div className="space-y-1">
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
      ) : (
        <div className="max-h-[70vh] overflow-y-auto px-2 pb-2">
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
      )}
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
      <main className="flex-1 flex flex-col min-h-0 container mx-auto px-4 py-4 md:py-6">
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

            {/* Edit Novel Dialog */}
            <Dialog open={isEditingNovel} onOpenChange={setIsEditingNovel}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>编辑小说信息</DialogTitle>
                  <DialogDescription>
                    修改小说的名称、类型和简介
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-title">小说标题 *</Label>
                    <Input
                      id="edit-title"
                      placeholder="输入小说标题"
                      value={editNovelData.title}
                      onChange={(e) => setEditNovelData({ ...editNovelData, title: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-genre">类型</Label>
                    <Select value={editNovelData.genre} onValueChange={(value) => setEditNovelData({ ...editNovelData, genre: value })}>
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
                    <Label htmlFor="edit-description">简介</Label>
                    <Textarea
                      id="edit-description"
                      placeholder="详细描述你的故事背景、主要人物、情节发展..."
                      value={editNovelData.description}
                      onChange={(e) => setEditNovelData({ ...editNovelData, description: e.target.value })}
                      rows={4}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsEditingNovel(false)}>取消</Button>
                  <Button onClick={handleEditNovel} disabled={isLoading}>
                    {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    保存
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Smart Generate Dialog */}
            <Dialog open={showSmartGenerate} onOpenChange={(open) => {
              setShowSmartGenerate(open)
              if (!open) {
                setIsGenerating(false)
                setGenerationProgress({
                  phase: '',
                  message: '',
                  current: 0,
                  total: 0,
                  currentTitle: '',
                  totalWords: 0,
                  progress: 0,
                  structure: null
                })
              }
            }}>
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
                  
                  {/* Progress Display */}
                  {isGenerating && (
                    <div className="space-y-4">
                      {/* Progress Bar */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{generationProgress.message}</span>
                          <span className="font-medium">{generationProgress.progress.toFixed(0)}%</span>
                        </div>
                        <Progress value={generationProgress.progress} className="h-2" />
                      </div>
                      
                      {/* Current Chapter */}
                      {generationProgress.currentTitle && (
                        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                          <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                          <span className="text-sm">
                            正在生成：<strong>{generationProgress.currentTitle}</strong>
                          </span>
                        </div>
                      )}
                      
                      {/* Story Structure */}
                      {generationProgress.structure && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20">
                            <CardHeader className="pb-2 pt-3 px-3">
                              <CardTitle className="text-sm flex items-center gap-1">
                                <BookOpen className="w-4 h-4 text-green-500" />
                                开头
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="pb-3 px-3">
                              <p className="text-xs text-muted-foreground">{generationProgress.structure.beginning}</p>
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
                              <p className="text-xs text-muted-foreground">{generationProgress.structure.middle}</p>
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
                              <p className="text-xs text-muted-foreground">{generationProgress.structure.ending}</p>
                            </CardContent>
                          </Card>
                        </div>
                      )}
                      
                      {/* Stats */}
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>已生成 {generationProgress.current} / {generationProgress.total} 章</span>
                        <span>共 {generationProgress.totalWords.toLocaleString()} 字</span>
                      </div>
                    </div>
                  )}
                  
                  {/* Settings (when not generating) */}
                  {!isGenerating && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>计划总字数（最大100万字）</Label>
                          <Select 
                            value={smartGenSettings.totalWords.toString()} 
                            onValueChange={(v) => setSmartGenSettings({ ...smartGenSettings, totalWords: parseInt(v) })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="10000">1万字</SelectItem>
                              <SelectItem value="30000">3万字</SelectItem>
                              <SelectItem value="50000">5万字</SelectItem>
                              <SelectItem value="100000">10万字</SelectItem>
                              <SelectItem value="200000">20万字</SelectItem>
                              <SelectItem value="300000">30万字</SelectItem>
                              <SelectItem value="500000">50万字</SelectItem>
                              <SelectItem value="800000">80万字</SelectItem>
                              <SelectItem value="1000000">100万字</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>章节数量（最大500章）</Label>
                          <Select 
                            value={smartGenSettings.chapterCount.toString()} 
                            onValueChange={(v) => setSmartGenSettings({ ...smartGenSettings, chapterCount: parseInt(v) })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="10">10 章</SelectItem>
                              <SelectItem value="20">20 章</SelectItem>
                              <SelectItem value="30">30 章</SelectItem>
                              <SelectItem value="50">50 章</SelectItem>
                              <SelectItem value="80">80 章</SelectItem>
                              <SelectItem value="100">100 章</SelectItem>
                              <SelectItem value="150">150 章</SelectItem>
                              <SelectItem value="200">200 章</SelectItem>
                              <SelectItem value="300">300 章</SelectItem>
                              <SelectItem value="400">400 章</SelectItem>
                              <SelectItem value="500">500 章</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>生成模式</Label>
                        <RadioGroup
                          value={smartGenSettings.generateMode}
                          onValueChange={(v) => setSmartGenSettings({ ...smartGenSettings, generateMode: v as 'full' | 'opening' })}
                          className="flex gap-4"
                        >
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="full" id="mode-full" />
                            <Label htmlFor="mode-full" className="font-normal cursor-pointer">整文生成</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="opening" id="mode-opening" />
                            <Label htmlFor="mode-opening" className="font-normal cursor-pointer">生成开头</Label>
                          </div>
                        </RadioGroup>
                        <p className="text-xs text-muted-foreground">
                          {smartGenSettings.generateMode === 'full' ? '每章生成完整正文（约800-1500字）' : '每章仅生成约100字开头，便于续写或扩写'}
                        </p>
                      </div>
                      
                      {/* Tips */}
                      <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg text-sm">
                        <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                        <div className="text-amber-700 dark:text-amber-300">
                          <p className="font-medium">生成说明</p>
                          <ul className="mt-1 space-y-1 text-xs list-disc list-inside">
                            <li>{smartGenSettings.generateMode === 'full' ? '每章约 800-1500 字完整正文' : '每章约 100 字开头'}</li>
                            <li>AI会自动维护上下文连贯性</li>
                            <li>大批量生成预计需要较长时间，请耐心等待</li>
                          </ul>
                        </div>
                      </div>
                      
                      {/* Time Estimate */}
                      {smartGenSettings.chapterCount > 30 && (
                        <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg text-sm">
                          <AlertCircle className="w-4 h-4 text-blue-500" />
                          <span className="text-blue-700 dark:text-blue-300">
                            预计生成时间：约 {Math.ceil(smartGenSettings.chapterCount / 3 * (smartGenSettings.generateMode === 'full' ? 1.5 : 0.5))} 分钟
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                <DialogFooter>
                  {!isGenerating ? (
                    <>
                      <Button variant="outline" onClick={() => setShowSmartGenerate(false)}>
                        取消
                      </Button>
                      <Button onClick={handleSmartGenerate} disabled={!smartGenNovel?.description}>
                        <Sparkles className="w-4 h-4 mr-2" />
                        开始生成
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" disabled>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      生成中，请稍候...
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
                                openEditNovelDialog(novel)
                              }}
                            >
                              <Edit3 className="w-4 h-4 mr-2" />
                              编辑信息
                            </DropdownMenuItem>
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
          <Dialog open={isCreatingChapter} onOpenChange={setIsCreatingChapter}>
            <div className="flex gap-4 min-h-0 flex-1 pb-6 md:pb-8">
              {/* Desktop Sidebar - Chapter List */}
              <div className="w-64 shrink-0 hidden md:flex md:flex-col md:min-h-0">
                <Card className="h-full flex flex-col min-h-0">
                  <CardHeader className="pb-2 shrink-0 flex flex-row items-center justify-between gap-2">
                    <CardTitle className="text-base">章节目录</CardTitle>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-1 shrink-0">
                        <Plus className="w-4 h-4" />
                        新建
                      </Button>
                    </DialogTrigger>
                  </CardHeader>
                  <CardContent className="p-0 flex-1 flex flex-col min-h-0 overflow-hidden">
                    <ChapterListComponent hideHeaderRow />
                  </CardContent>
                </Card>
              </div>

            {/* Main Editor */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
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
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-8 gap-1"
                          onClick={loadChapterRevisions}
                          disabled={loadingRevisions}
                        >
                          {loadingRevisions ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookMarked className="w-4 h-4" />}
                          历史版本
                        </Button>
                        <span className="tabular-nums">{editingContent.length.toLocaleString()} 字</span>
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
                      <TabsTrigger value="outline" className="gap-1 md:gap-2 text-xs md:text-sm">
                        <BookOpen className="w-3 h-3 md:w-4 md:h-4" />
                        大纲
                      </TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="write" className="flex-1 mt-3 md:mt-4">
                      <Textarea
                        placeholder="开始你的创作..."
                        className="h-full max-h-[70vh] min-h-[40vh] overflow-y-auto resize-none text-base leading-relaxed"
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        ref={editorRef}
                        onSelect={(e) => {
                          const target = e.target as HTMLTextAreaElement
                          setSelectionRange({ start: target.selectionStart, end: target.selectionEnd })
                        }}
                      />
                    </TabsContent>
                    
                    <TabsContent value="ai" className="flex-1 mt-3 md:mt-4 space-y-3 md:space-y-4 overflow-y-auto">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-muted-foreground">
                          {selectionRange && selectionRange.start !== selectionRange.end
                            ? `已选中 ${selectionRange.end - selectionRange.start} 字符`
                            : '未选中内容（默认作用于整章）'}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">候选</span>
                          <Select
                            value={String(aiVariants)}
                            onValueChange={(v) => setAiVariants((Number(v) as 1 | 3 | 5) || 1)}
                          >
                            <SelectTrigger className="h-8 w-[88px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">1</SelectItem>
                              <SelectItem value="3">3</SelectItem>
                              <SelectItem value="5">5</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:gap-3">
                        <Button 
                          variant="outline" 
                          className="h-auto py-3 md:py-4 flex flex-col gap-1 touch-manipulation"
                          onClick={handleAIContinue}
                          disabled={isAILoading}
                        >
                          {isAILoading && aiMode === 'continue' ? (
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
                          {isAILoading && aiMode === 'continue' ? (
                            <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                          ) : (
                            <FileText className="w-4 h-4 md:w-5 md:h-5 text-blue-500" />
                          )}
                          <span className="text-xs md:text-sm">生成标题</span>
                          <span className="text-[10px] md:text-xs text-muted-foreground hidden md:block">根据内容生成章节标题</span>
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:gap-3">
                        <Button
                          variant="outline"
                          className="h-auto py-3 md:py-4 flex flex-col gap-1 touch-manipulation"
                          onClick={() => handleAIRefine('polish')}
                          disabled={isAILoading}
                        >
                          {isAILoading && aiMode === 'polish' ? (
                            <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-emerald-500" />
                          )}
                          <span className="text-xs md:text-sm">润色优化</span>
                          <span className="text-[10px] md:text-xs text-muted-foreground hidden md:block">
                            提升文笔表达，保持原意
                          </span>
                        </Button>
                        <Button
                          variant="outline"
                          className="h-auto py-3 md:py-4 flex flex-col gap-1 touch-manipulation"
                          onClick={() => handleAIRefine('shorten')}
                          disabled={isAILoading}
                        >
                          {isAILoading && aiMode === 'shorten' ? (
                            <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-purple-500" />
                          )}
                          <span className="text-xs md:text-sm">精简文本</span>
                          <span className="text-[10px] md:text-xs text-muted-foreground hidden md:block">
                            保留重点，压缩篇幅
                          </span>
                        </Button>
                      </div>

                      {/* 描写增强 - 4 个细分动作 */}
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">描写增强（选中内容）</div>
                        <div className="grid grid-cols-2 gap-2 md:gap-3">
                          <Button
                            variant="outline"
                            className="h-auto py-2 md:py-3 flex flex-col gap-0.5 touch-manipulation"
                            onClick={() => handleAIDescribe('environment')}
                            disabled={isAILoading}
                          >
                            <span className="text-xs md:text-sm">🌿 环境</span>
                            <span className="text-[10px] text-muted-foreground hidden md:block">天气、光线、氛围</span>
                          </Button>
                          <Button
                            variant="outline"
                            className="h-auto py-2 md:py-3 flex flex-col gap-0.5 touch-manipulation"
                            onClick={() => handleAIDescribe('emotion')}
                            disabled={isAILoading}
                          >
                            <span className="text-xs md:text-sm">💭 情绪</span>
                            <span className="text-[10px] text-muted-foreground hidden md:block">内心、表情、张力</span>
                          </Button>
                          <Button
                            variant="outline"
                            className="h-auto py-2 md:py-3 flex flex-col gap-0.5 touch-manipulation"
                            onClick={() => handleAIDescribe('action')}
                            disabled={isAILoading}
                          >
                            <span className="text-xs md:text-sm">⚡ 动作</span>
                            <span className="text-[10px] text-muted-foreground hidden md:block">分解、节奏、画面</span>
                          </Button>
                          <Button
                            variant="outline"
                            className="h-auto py-2 md:py-3 flex flex-col gap-0.5 touch-manipulation"
                            onClick={() => handleAIDescribe('dialogue')}
                            disabled={isAILoading}
                          >
                            <span className="text-xs md:text-sm">💬 对话</span>
                            <span className="text-[10px] text-muted-foreground hidden md:block">语气、潜台词、节奏</span>
                          </Button>
                        </div>
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

                      {aiCandidates.length > 0 && (
                        <div className="space-y-3">
                          {aiCandidates.map((c, idx) => (
                            <Card key={idx} className="border-amber-200/60">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm">候选 {idx + 1}</CardTitle>
                              </CardHeader>
                              <CardContent>
                                {diffCandidateIndex === idx ? (
                                  <DiffView original={getDiffOriginalText()} candidate={c} onClose={() => setDiffCandidateIndex(null)} />
                                ) : (
                                  <>
                                    <p className="text-sm whitespace-pre-wrap mb-3">{c}</p>
                                    <div className="flex gap-2 flex-wrap">
                                      <Button
                                        size="sm"
                                        onClick={() => {
                                          applyCandidate(c, 'replace', `ai_${aiMode}`)
                                          setAiCandidates([])
                                          setDiffCandidateIndex(null)
                                        }}
                                      >
                                        替换
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          applyCandidate(c, 'insert', `ai_${aiMode}`)
                                          setAiCandidates([])
                                          setDiffCandidateIndex(null)
                                        }}
                                      >
                                        插入
                                      </Button>
                                      <Button size="sm" variant="ghost" onClick={() => setDiffCandidateIndex(idx)}>
                                        对比
                                      </Button>
                                      <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(c)}>
                                        复制
                                      </Button>
                                    </div>
                                  </>
                                )}
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="tts" className="flex-1 mt-3 md:mt-4 overflow-y-auto">
                      <TTSPlayer content={editingContent} disabled={!editingContent.trim()} />
                    </TabsContent>

                    <TabsContent value="outline" className="flex-1 mt-3 md:mt-4 overflow-y-auto">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold">故事大纲</h3>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={generateOutline} disabled={isLoading}>
                              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                              生成大纲
                            </Button>
                            {storyOutline && (
                              <Button size="sm" variant="outline" onClick={batchGenerateOpenings} disabled={batchGenerating}>
                                {batchGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                                批量生成开头
                              </Button>
                            )}
                          </div>
                        </div>
                        
                        {storyOutline ? (
                          <div className="space-y-4">
                            <Card className="bg-slate-50 dark:bg-slate-950">
                              <CardContent className="p-4 space-y-2">
                                <div className="text-sm font-medium">故事结构</div>
                                <div className="text-xs text-muted-foreground space-y-1">
                                  <p><span className="font-medium text-blue-600">开头：</span>{storyOutline.beginning?.slice(0, 100)}...</p>
                                  <p><span className="font-medium text-amber-600">经过：</span>{storyOutline.middle?.slice(0, 100)}...</p>
                                  <p><span className="font-medium text-green-600">结尾：</span>{storyOutline.ending?.slice(0, 100)}...</p>
                                </div>
                              </CardContent>
                            </Card>
                            
                            <div className="space-y-2">
                              <div className="text-sm font-medium">章节列表</div>
                              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                                {storyOutline.chapters?.map((ch, idx) => (
                                  <Card key={idx} className="border-l-4 border-l-amber-400">
                                    <CardContent className="p-3">
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                          <div className="text-sm font-medium mb-1">
                                            第{idx + 1}章 {editingOutlineChapter === idx ? (
                                              <Input
                                                value={ch.title}
                                                onChange={(e) => updateOutlineChapter(idx, { title: e.target.value })}
                                                onBlur={() => setEditingOutlineChapter(null)}
                                                className="inline-block w-48 h-7 text-sm"
                                                autoFocus
                                              />
                                            ) : (
                                              <span onClick={() => setEditingOutlineChapter(idx)} className="cursor-pointer hover:text-amber-600">
                                                {ch.title}
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-xs text-muted-foreground line-clamp-2">{ch.outline}</div>
                                        </div>
                                        <div className="flex gap-1 shrink-0">
                                          <Button 
                                            size="sm" 
                                            variant="ghost" 
                                            className="h-7 w-7 p-0"
                                            onClick={() => generateChapterOpening(idx)}
                                            disabled={isAILoading || currentNovel?.chapters?.some(c => c.order === idx)}
                                            title="生成开头"
                                          >
                                            <Sparkles className="w-4 h-4" />
                                          </Button>
                                        </div>
                                      </div>
                                    </CardContent>
                                  </Card>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-50" />
                            <p className="text-sm">暂无大纲</p>
                            <p className="text-xs mt-1">点击上方"生成大纲"按钮创建故事结构</p>
                          </div>
                        )}
                      </div>
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

      {/* Chapter Revision History Dialog (P2-2) */}
      <Dialog open={showRevisions} onOpenChange={setShowRevisions}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>章节历史版本</DialogTitle>
            <DialogDescription>
              {currentChapter?.title} - 共 {chapterRevisions.length} 个历史版本
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-4 max-h-[60vh] overflow-y-auto">
            {chapterRevisions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <BookMarked className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">暂无历史版本</p>
                <p className="text-xs mt-1">每次 AI 修改都会自动保存历史版本</p>
              </div>
            ) : (
              chapterRevisions.map((rev, idx) => (
                <Card key={rev.id} className="border-l-4 border-l-blue-400">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">版本 {chapterRevisions.length - idx}</span>
                          <Badge variant="secondary" className="text-xs">
                            {rev.source === 'ai_continue' && 'AI续写'}
                            {rev.source === 'ai_polish' && '润色'}
                            {rev.source === 'ai_shorten' && '精简'}
                            {rev.source === 'ai_expand' && '扩写'}
                            {rev.source === 'ai_describe' && '细节描写'}
                            {rev.source === 'manual' && '手动编辑'}
                            {rev.source === 'ai_apply' && 'AI建议'}
                            {rev.source === 'ai_candidate' && 'AI候选'}
                            {rev.source === 'restore' && '恢复版本'}
                            {!['ai_continue', 'ai_polish', 'ai_shorten', 'ai_expand', 'ai_describe', 'manual', 'ai_apply', 'ai_candidate', 'restore'].includes(rev.source) && rev.source}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(rev.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-3">
                          {rev.content.slice(0, 150)}{rev.content.length > 150 ? '...' : ''}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {rev.wordCount} 字
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => restoreRevision(rev.id)}
                        disabled={loadingRevisions}
                      >
                        恢复此版本
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Toaster />
    </div>
  )
}

// Simple diff view component (inline for now, can be extracted to separate file)
function DiffView({ original, candidate, onClose }: { original: string; candidate: string; onClose: () => void }) {
  const diffParts = useMemo(() => {
    // Simple word-level diff visualization
    const origWords = original.split(/(\s+)/)
    const candWords = candidate.split(/(\s+)/)
    const maxLen = Math.max(origWords.length, candWords.length)
    const parts: { type: 'same' | 'removed' | 'added'; text: string }[] = []

    for (let i = 0; i < maxLen; i++) {
      const o = origWords[i] || ''
      const c = candWords[i] || ''
      if (o === c && o) {
        if (parts.length > 0 && parts[parts.length - 1].type === 'same') {
          parts[parts.length - 1].text += o
        } else {
          parts.push({ type: 'same', text: o })
        }
      } else {
        if (o) {
          if (parts.length > 0 && parts[parts.length - 1].type === 'removed') {
            parts[parts.length - 1].text += o
          } else {
            parts.push({ type: 'removed', text: o })
          }
        }
        if (c) {
          if (parts.length > 0 && parts[parts.length - 1].type === 'added') {
            parts[parts.length - 1].text += c
          } else {
            parts.push({ type: 'added', text: c })
          }
        }
      }
    }
    return parts
  }, [original, candidate])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">对比视图（绿色=新增，红色=删除）</span>
        <Button size="sm" variant="ghost" onClick={onClose}>关闭对比</Button>
      </div>
      <div className="text-sm whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-slate-950 p-3 rounded-md max-h-[40vh] overflow-y-auto">
        {diffParts.map((part, i) => (
          <span
            key={i}
            className={
              part.type === 'removed'
                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 line-through decoration-red-400'
                : part.type === 'added'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                  : ''
            }
          >
            {part.text}
          </span>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">
        原文 {original.length} 字 → 候选 {candidate.length} 字
      </div>
    </div>
  )
}
