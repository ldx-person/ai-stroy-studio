'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  BookOpen,
  Users,
  Globe,
  Clock,
  Palette,
  Plus,
  Trash2,
  Edit3,
  Save,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

// Types
interface Character {
  id: string
  name: string
  role: 'protagonist' | 'supporting' | 'antagonist' | 'other'
  personality: string
  motivation: string
  speech: string
  relationships: string
  appearance: string
  background: string
}

interface WorldRule {
  id: string
  name: string
  description: string
  constraints: string
}

interface TimelineEvent {
  id: string
  chapter: number
  event: string
  impact: string
}

interface StyleGuide {
  pov: string
  tense: string
  tone: string
  taboos: string[]
}

interface StoryBible {
  characters: Character[]
  worldRules: WorldRule[]
  timeline: TimelineEvent[]
  styleGuide: StyleGuide
}

const defaultStoryBible: StoryBible = {
  characters: [],
  worldRules: [],
  timeline: [],
  styleGuide: {
    pov: '第三人称',
    tense: '过去时',
    tone: '轻松幽默',
    taboos: [],
  },
}

const roleLabels: Record<Character['role'], string> = {
  protagonist: '主角',
  supporting: '配角',
  antagonist: '反派',
  other: '其他',
}

const roleColors: Record<Character['role'], string> = {
  protagonist: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  supporting: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  antagonist: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300',
}

interface StoryBibleEditorProps {
  novelId: string
  novelTitle: string
  novelDescription?: string | null
  onSave?: () => void
}

export function StoryBibleEditor({ novelId, novelTitle, novelDescription, onSave }: StoryBibleEditorProps) {
  const [storyBible, setStoryBible] = useState<StoryBible>(defaultStoryBible)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('characters')
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null)
  const [editingWorldRule, setEditingWorldRule] = useState<WorldRule | null>(null)
  const [editingTimeline, setEditingTimeline] = useState<TimelineEvent | null>(null)
  const [showCharacterDialog, setShowCharacterDialog] = useState(false)
  const [showWorldRuleDialog, setShowWorldRuleDialog] = useState(false)
  const [showTimelineDialog, setShowTimelineDialog] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    characters: true,
    worldRules: true,
    timeline: true,
    styleGuide: true,
  })
  const [newTaboo, setNewTaboo] = useState('')

  const { toast } = useToast()

  // Load story bible
  useEffect(() => {
    const loadStoryBible = async () => {
      setIsLoading(true)
      try {
        const res = await fetch(`/api/story-bible?novelId=${novelId}`)
        const data = await res.json()
        if (data.success && data.storyBible) {
          setStoryBible({
            ...defaultStoryBible,
            ...data.storyBible,
            styleGuide: {
              ...defaultStoryBible.styleGuide,
              ...(data.storyBible.styleGuide || {}),
            },
          })
        }
      } catch (error) {
        console.error('Load story bible error:', error)
      }
      setIsLoading(false)
    }
    loadStoryBible()
  }, [novelId])

  // Save story bible
  const handleSave = async () => {
    setIsSaving(true)
    try {
      const res = await fetch('/api/story-bible', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelId, storyBible }),
      })
      const data = await res.json()
      if (data.success) {
        toast({ title: '作品档案已保存' })
        onSave?.()
      } else {
        toast({ title: data.error || '保存失败', variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: '保存失败', variant: 'destructive' })
    }
    setIsSaving(false)
  }

  // AI generate story bible
  const handleAIGenerate = async () => {
    if (!novelDescription || novelDescription.length < 20) {
      toast({ title: '请先填写小说简介（至少20字）', variant: 'destructive' })
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch('/api/ai/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'story-bible',
          input: {
            scope: 'chapter',
            text: `小说标题：${novelTitle}\n\n简介：${novelDescription}`,
          },
          options: { variants: 1 },
        }),
      })
      const data = await res.json()
      if (data.success && data.candidates?.[0]?.text) {
        try {
          const parsed = JSON.parse(data.candidates[0].text)
          setStoryBible({
            ...defaultStoryBible,
            ...parsed,
            styleGuide: {
              ...defaultStoryBible.styleGuide,
              ...(parsed.styleGuide || {}),
            },
          })
          toast({ title: 'AI 已生成作品档案' })
        } catch {
          toast({ title: 'AI 返回格式错误，请重试', variant: 'destructive' })
        }
      } else {
        toast({ title: data.error || 'AI 生成失败', variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'AI 生成失败', variant: 'destructive' })
    }
    setIsLoading(false)
  }

  // Character operations
  const addCharacter = (character: Character) => {
    setStoryBible(prev => ({
      ...prev,
      characters: [...prev.characters, { ...character, id: character.id || `char_${Date.now()}` }],
    }))
  }

  const updateCharacter = (character: Character) => {
    setStoryBible(prev => ({
      ...prev,
      characters: prev.characters.map(c => (c.id === character.id ? character : c)),
    }))
  }

  const deleteCharacter = (id: string) => {
    setStoryBible(prev => ({
      ...prev,
      characters: prev.characters.filter(c => c.id !== id),
    }))
  }

  // World rule operations
  const addWorldRule = (rule: WorldRule) => {
    setStoryBible(prev => ({
      ...prev,
      worldRules: [...prev.worldRules, { ...rule, id: rule.id || `rule_${Date.now()}` }],
    }))
  }

  const updateWorldRule = (rule: WorldRule) => {
    setStoryBible(prev => ({
      ...prev,
      worldRules: prev.worldRules.map(r => (r.id === rule.id ? rule : r)),
    }))
  }

  const deleteWorldRule = (id: string) => {
    setStoryBible(prev => ({
      ...prev,
      worldRules: prev.worldRules.filter(r => r.id !== id),
    }))
  }

  // Timeline operations
  const addTimelineEvent = (event: TimelineEvent) => {
    setStoryBible(prev => ({
      ...prev,
      timeline: [...prev.timeline, { ...event, id: event.id || `event_${Date.now() } }` }].sort((a, b) => a.chapter - b.chapter),
    }))
  }

  const updateTimelineEvent = (event: TimelineEvent) => {
    setStoryBible(prev => ({
      ...prev,
      timeline: prev.timeline.map(e => (e.id === event.id ? event : e)).sort((a, b) => a.chapter - b.chapter),
    }))
  }

  const deleteTimelineEvent = (id: string) => {
    setStoryBible(prev => ({
      ...prev,
      timeline: prev.timeline.filter(e => e.id !== id),
    }))
  }

  // Style guide operations
  const updateStyleGuide = (updates: Partial<StyleGuide>) => {
    setStoryBible(prev => ({
      ...prev,
      styleGuide: { ...prev.styleGuide, ...updates },
    }))
  }

  const addTaboo = () => {
    if (newTaboo.trim()) {
      updateStyleGuide({ taboos: [...(storyBible.styleGuide.taboos || []), newTaboo.trim()] })
      setNewTaboo('')
    }
  }

  const removeTaboo = (index: number) => {
    updateStyleGuide({
      taboos: (storyBible.styleGuide.taboos || []).filter((_, i) => i !== index),
    })
  }

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-500" />
            作品档案
          </h3>
          <p className="text-sm text-muted-foreground">
            角色卡、世界观、时间线、文风规则，AI 生成时自动注入
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleAIGenerate} disabled={isLoading}>
            <Sparkles className="w-4 h-4 mr-1" />
            AI 生成
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            保存
          </Button>
        </div>
      </div>

      <Separator />

      {/* Characters Section */}
      <Card>
        <CardHeader className="pb-3 cursor-pointer" onClick={() => toggleSection('characters')}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-500" />
              角色卡
              <Badge variant="secondary" className="ml-2">{storyBible.characters.length}</Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={e => {
                  e.stopPropagation()
                  setEditingCharacter(null)
                  setShowCharacterDialog(true)
                }}
              >
                <Plus className="w-4 h-4" />
              </Button>
              {expandedSections.characters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </CardHeader>
        {expandedSections.characters && (
          <CardContent className="pt-0">
            {storyBible.characters.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                暂无角色，点击 + 添加或使用 AI 生成
              </div>
            ) : (
              <div className="space-y-3">
                {storyBible.characters.map(char => (
                  <div key={char.id} className="flex items-start justify-between p-3 rounded-lg border bg-slate-50 dark:bg-slate-900">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{char.name}</span>
                        <Badge className={roleColors[char.role]}>{roleLabels[char.role]}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {char.personality || char.motivation || '暂无描述'}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditingCharacter(char)
                          setShowCharacterDialog(true)
                        }}
                      >
                        <Edit3 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500"
                        onClick={() => deleteCharacter(char.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* World Rules Section */}
      <Card>
        <CardHeader className="pb-3 cursor-pointer" onClick={() => toggleSection('worldRules')}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="w-4 h-4 text-green-500" />
              世界观设定
              <Badge variant="secondary" className="ml-2">{storyBible.worldRules.length}</Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={e => {
                  e.stopPropagation()
                  setEditingWorldRule(null)
                  setShowWorldRuleDialog(true)
                }}
              >
                <Plus className="w-4 h-4" />
              </Button>
              {expandedSections.worldRules ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </CardHeader>
        {expandedSections.worldRules && (
          <CardContent className="pt-0">
            {storyBible.worldRules.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                暂无世界观设定，点击 + 添加或使用 AI 生成
              </div>
            ) : (
              <div className="space-y-3">
                {storyBible.worldRules.map(rule => (
                  <div key={rule.id} className="flex items-start justify-between p-3 rounded-lg border bg-slate-50 dark:bg-slate-900">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium mb-1">{rule.name}</div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {rule.description || '暂无描述'}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditingWorldRule(rule)
                          setShowWorldRuleDialog(true)
                        }}
                      >
                        <Edit3 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500"
                        onClick={() => deleteWorldRule(rule.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Timeline Section */}
      <Card>
        <CardHeader className="pb-3 cursor-pointer" onClick={() => toggleSection('timeline')}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-purple-500" />
              时间线
              <Badge variant="secondary" className="ml-2">{storyBible.timeline.length}</Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={e => {
                  e.stopPropagation()
                  setEditingTimeline(null)
                  setShowTimelineDialog(true)
                }}
              >
                <Plus className="w-4 h-4" />
              </Button>
              {expandedSections.timeline ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </CardHeader>
        {expandedSections.timeline && (
          <CardContent className="pt-0">
            {storyBible.timeline.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                暂无时间线，点击 + 添加或使用 AI 生成
              </div>
            ) : (
              <div className="space-y-2">
                {storyBible.timeline.map(event => (
                  <div key={event.id} className="flex items-start justify-between p-3 rounded-lg border bg-slate-50 dark:bg-slate-900">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline">第 {event.chapter} 章</Badge>
                        <span className="font-medium">{event.event}</span>
                      </div>
                      {event.impact && (
                        <p className="text-sm text-muted-foreground">影响：{event.impact}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditingTimeline(event)
                          setShowTimelineDialog(true)
                        }}
                      >
                        <Edit3 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500"
                        onClick={() => deleteTimelineEvent(event.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Style Guide Section */}
      <Card>
        <CardHeader className="pb-3 cursor-pointer" onClick={() => toggleSection('styleGuide')}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Palette className="w-4 h-4 text-pink-500" />
              文风规则
            </CardTitle>
            {expandedSections.styleGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </CardHeader>
        {expandedSections.styleGuide && (
          <CardContent className="pt-0 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>叙述视角</Label>
                <Input
                  value={storyBible.styleGuide.pov}
                  onChange={e => updateStyleGuide({ pov: e.target.value })}
                  placeholder="如：第一人称、第三人称"
                />
              </div>
              <div className="space-y-2">
                <Label>时态</Label>
                <Input
                  value={storyBible.styleGuide.tense}
                  onChange={e => updateStyleGuide({ tense: e.target.value })}
                  placeholder="如：过去时、现在时"
                />
              </div>
              <div className="space-y-2">
                <Label>基调</Label>
                <Input
                  value={storyBible.styleGuide.tone}
                  onChange={e => updateStyleGuide({ tone: e.target.value })}
                  placeholder="如：轻松幽默、严肃深沉"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>禁用表达</Label>
              <div className="flex gap-2">
                <Input
                  value={newTaboo}
                  onChange={e => setNewTaboo(e.target.value)}
                  placeholder="输入要禁用的表达"
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTaboo())}
                />
                <Button variant="outline" onClick={addTaboo}>添加</Button>
              </div>
              {storyBible.styleGuide.taboos && storyBible.styleGuide.taboos.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {storyBible.styleGuide.taboos.map((taboo, i) => (
                    <Badge key={i} variant="secondary" className="gap-1">
                      {taboo}
                      <X className="w-3 h-3 cursor-pointer" onClick={() => removeTaboo(i)} />
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Character Dialog */}
      <Dialog open={showCharacterDialog} onOpenChange={setShowCharacterDialog}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCharacter ? '编辑角色' : '添加角色'}</DialogTitle>
          </DialogHeader>
          <CharacterForm
            character={editingCharacter}
            onSave={char => {
              if (editingCharacter) {
                updateCharacter(char)
              } else {
                addCharacter(char)
              }
              setShowCharacterDialog(false)
              setEditingCharacter(null)
            }}
            onCancel={() => {
              setShowCharacterDialog(false)
              setEditingCharacter(null)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* World Rule Dialog */}
      <Dialog open={showWorldRuleDialog} onOpenChange={setShowWorldRuleDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingWorldRule ? '编辑世界观' : '添加世界观'}</DialogTitle>
          </DialogHeader>
          <WorldRuleForm
            rule={editingWorldRule}
            onSave={rule => {
              if (editingWorldRule) {
                updateWorldRule(rule)
              } else {
                addWorldRule(rule)
              }
              setShowWorldRuleDialog(false)
              setEditingWorldRule(null)
            }}
            onCancel={() => {
              setShowWorldRuleDialog(false)
              setEditingWorldRule(null)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Timeline Dialog */}
      <Dialog open={showTimelineDialog} onOpenChange={setShowTimelineDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTimeline ? '编辑时间线' : '添加时间线'}</DialogTitle>
          </DialogHeader>
          <TimelineForm
            event={editingTimeline}
            onSave={event => {
              if (editingTimeline) {
                updateTimelineEvent(event)
              } else {
                addTimelineEvent(event)
              }
              setShowTimelineDialog(false)
              setEditingTimeline(null)
            }}
            onCancel={() => {
              setShowTimelineDialog(false)
              setEditingTimeline(null)
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Character Form Component
function CharacterForm({
  character,
  onSave,
  onCancel,
}: {
  character: Character | null
  onSave: (char: Character) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<Character>(
    character || {
      id: '',
      name: '',
      role: 'supporting',
      personality: '',
      motivation: '',
      speech: '',
      relationships: '',
      appearance: '',
      background: '',
    }
  )

  return (
    <div className="space-y-4 py-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>角色名 *</Label>
          <Input
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="输入角色名"
          />
        </div>
        <div className="space-y-2">
          <Label>角色类型</Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={form.role}
            onChange={e => setForm({ ...form, role: e.target.value as Character['role'] })}
          >
            <option value="protagonist">主角</option>
            <option value="supporting">配角</option>
            <option value="antagonist">反派</option>
            <option value="other">其他</option>
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>性格特点</Label>
        <Textarea
          value={form.personality}
          onChange={e => setForm({ ...form, personality: e.target.value })}
          placeholder="描述角色的性格特点"
          rows={2}
        />
      </div>
      <div className="space-y-2">
        <Label>动机目标</Label>
        <Textarea
          value={form.motivation}
          onChange={e => setForm({ ...form, motivation: e.target.value })}
          placeholder="角色的核心动机和目标"
          rows={2}
        />
      </div>
      <div className="space-y-2">
        <Label>说话风格 / 口癖</Label>
        <Textarea
          value={form.speech}
          onChange={e => setForm({ ...form, speech: e.target.value })}
          placeholder="角色的说话方式、口头禅"
          rows={2}
        />
      </div>
      <div className="space-y-2">
        <Label>人物关系</Label>
        <Textarea
          value={form.relationships}
          onChange={e => setForm({ ...form, relationships: e.target.value })}
          placeholder="与其他角色的关系"
          rows={2}
        />
      </div>
      <div className="space-y-2">
        <Label>外貌描写</Label>
        <Textarea
          value={form.appearance}
          onChange={e => setForm({ ...form, appearance: e.target.value })}
          placeholder="角色的外貌特征"
          rows={2}
        />
      </div>
      <div className="space-y-2">
        <Label>背景故事</Label>
        <Textarea
          value={form.background}
          onChange={e => setForm({ ...form, background: e.target.value })}
          placeholder="角色的背景故事"
          rows={2}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button onClick={() => onSave({ ...form, id: form.id || `char_${Date.now()}` })} disabled={!form.name.trim()}>
          保存
        </Button>
      </DialogFooter>
    </div>
  )
}

// World Rule Form Component
function WorldRuleForm({
  rule,
  onSave,
  onCancel,
}: {
  rule: WorldRule | null
  onSave: (rule: WorldRule) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<WorldRule>(
    rule || {
      id: '',
      name: '',
      description: '',
      constraints: '',
    }
  )

  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label>设定名称 *</Label>
        <Input
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          placeholder="如：魔法体系、势力分布"
        />
      </div>
      <div className="space-y-2">
        <Label>设定描述</Label>
        <Textarea
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
          placeholder="详细描述这个设定"
          rows={3}
        />
      </div>
      <div className="space-y-2">
        <Label>约束条件</Label>
        <Textarea
          value={form.constraints}
          onChange={e => setForm({ ...form, constraints: e.target.value })}
          placeholder="这个设定的限制和规则"
          rows={2}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button onClick={() => onSave({ ...form, id: form.id || `rule_${Date.now()}` })} disabled={!form.name.trim()}>
          保存
        </Button>
      </DialogFooter>
    </div>
  )
}

// Timeline Form Component
function TimelineForm({
  event,
  onSave,
  onCancel,
}: {
  event: TimelineEvent | null
  onSave: (event: TimelineEvent) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<TimelineEvent>(
    event || {
      id: '',
      chapter: 1,
      event: '',
      impact: '',
    }
  )

  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label>章节号 *</Label>
        <Input
          type="number"
          min={1}
          value={form.chapter}
          onChange={e => setForm({ ...form, chapter: parseInt(e.target.value) || 1 })}
        />
      </div>
      <div className="space-y-2">
        <Label>事件描述 *</Label>
        <Textarea
          value={form.event}
          onChange={e => setForm({ ...form, event: e.target.value })}
          placeholder="这个章节发生的关键事件"
          rows={2}
        />
      </div>
      <div className="space-y-2">
        <Label>影响</Label>
        <Textarea
          value={form.impact}
          onChange={e => setForm({ ...form, impact: e.target.value })}
          placeholder="这个事件对后续剧情的影响"
          rows={2}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button onClick={() => onSave({ ...form, id: form.id || `event_${Date.now()}` })} disabled={!form.event.trim()}>
          保存
        </Button>
      </DialogFooter>
    </div>
  )
}

// X Icon component (inline)
function X({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}
