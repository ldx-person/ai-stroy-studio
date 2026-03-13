'use client'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileText, Plus, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreVertical } from 'lucide-react'

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

interface ChapterListProps {
  chapters: Chapter[]
  currentChapterId?: string
  onSelectChapter: (chapter: Chapter) => void
  onDeleteChapter: (chapterId: string) => void
  onCreateChapter?: () => void
  showCreateButton?: boolean
  compact?: boolean
}

export function ChapterList({
  chapters,
  currentChapterId,
  onSelectChapter,
  onDeleteChapter,
  onCreateChapter,
  showCreateButton = true,
  compact = false
}: ChapterListProps) {
  const sortedChapters = [...chapters].sort((a, b) => a.order - b.order)

  return (
    <div className={compact ? 'py-2' : ''}>
      {showCreateButton && (
        <div className="flex items-center justify-between mb-3">
          {!compact && <h3 className="font-semibold">章节目录</h3>}
          {onCreateChapter && (
            <Button variant="ghost" size="sm" className="gap-1" onClick={onCreateChapter}>
              <Plus className="w-4 h-4" />
              新建
            </Button>
          )}
        </div>
      )}
      <ScrollArea className={compact ? 'h-[60vh]' : 'h-[calc(100%-60px)]'}>
        <div className={compact ? 'space-y-1' : 'px-2 pb-2'}>
          {sortedChapters.map((chapter) => (
            <div
              key={chapter.id}
              className={`group flex items-center gap-2 px-3 py-3 rounded-lg cursor-pointer transition-colors touch-manipulation ${
                currentChapterId === chapter.id
                  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                  : 'hover:bg-muted active:bg-muted'
              }`}
              onClick={() => onSelectChapter(chapter)}
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate text-sm">{chapter.title}</span>
              <span className="text-xs text-muted-foreground">{chapter.wordCount}字</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 touch-manipulation">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem 
                    className="text-red-600"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteChapter(chapter.id)
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          {chapters.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              暂无章节<br />点击上方新建
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
