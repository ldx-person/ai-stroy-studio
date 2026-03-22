'use client'

import { memo } from 'react'
import { compareChaptersReadingOrder } from '@/lib/chapter-meta'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DialogTrigger } from '@/components/ui/dialog'
import { FileText, Plus, Trash2 } from 'lucide-react'

export interface EditorChapterListItem {
  id: string
  novelId: string
  chapterNumber: number
  title: string
  content: string
  wordCount: number
  order: number
  isPublished: boolean
  createdAt: string
  updatedAt: string
}

export type EditorChapterListVariant = 'sidebar' | 'sheet'

export interface EditorChapterListProps {
  chapters: EditorChapterListItem[]
  currentChapterId?: string | null
  onSelectChapter: (chapter: EditorChapterListItem) => void
  onDeleteChapter: (chapterId: string) => void
  /** 桌面侧栏：flex 内 native 滚动，避免父组件重渲染导致视口被卸载而滚回顶部 */
  variant: EditorChapterListVariant
  /** 桌面 CardHeader 已含「章节目录+新建」时隐藏本列表顶部行 */
  hideHeaderRow?: boolean
  /**
   * Sheet 内是否显示「新建」且用 DialogTrigger（必须在 Dialog 子树内）。
   * 底部导航里的目录 Sheet 不在 Dialog 内，应传 false。
   */
  showInlineCreateTrigger?: boolean
}

function EditorChapterListInner({
  chapters,
  currentChapterId,
  onSelectChapter,
  onDeleteChapter,
  variant,
  hideHeaderRow = false,
  showInlineCreateTrigger = true,
}: EditorChapterListProps) {
  const sortedChapters = [...chapters].sort(compareChaptersReadingOrder)

  const rows = sortedChapters.map((chapter) => (
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
      <span className="shrink-0 tabular-nums text-xs font-medium text-muted-foreground min-w-[3.25rem]">
        第{chapter.chapterNumber ?? (chapter.order ?? 0) + 1}章
      </span>
      <span className="flex-1 truncate text-sm">{chapter.title}</span>
      <span className="text-xs text-muted-foreground shrink-0">{chapter.wordCount}字</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 opacity-0 group-hover:opacity-100 touch-manipulation shrink-0"
        onClick={(e) => {
          e.stopPropagation()
          onDeleteChapter(chapter.id)
        }}
      >
        <Trash2 className="w-4 h-4 text-red-500" />
      </Button>
    </div>
  ))

  const empty = (
    <div className="text-center py-8 text-muted-foreground text-sm">
      暂无章节
      <br />
      点击上方新建
    </div>
  )

  return (
    <div
      className={
        variant === 'sheet'
          ? 'py-2'
          : /* 侧栏：由 page 内层滚动容器限高；此处随内容增高 */
            'w-full min-w-0'
      }
    >
      {!hideHeaderRow && (
        <div className="flex items-center justify-between mb-3 px-2 shrink-0">
          {variant === 'sheet' && <h3 className="font-semibold">章节目录</h3>}
          {variant === 'sheet' && showInlineCreateTrigger ? (
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1">
                <Plus className="w-4 h-4" />
                新建
              </Button>
            </DialogTrigger>
          ) : null}
        </div>
      )}
      {variant === 'sheet' ? (
        <ScrollArea className="h-[60vh]">
          <div className="space-y-1 px-1 pb-6">{rows.length ? rows : empty}</div>
        </ScrollArea>
      ) : (
        /* 桌面侧栏：滚动由 page 侧栏内层 div 承担；底部多留空，避免最后一行贴边/被裁切 */
        <div className="w-full min-w-0">
          <div className="space-y-1 px-2 pr-1 pb-6 pt-1">{rows.length ? rows : empty}</div>
        </div>
      )}
    </div>
  )
}

export const EditorChapterList = memo(EditorChapterListInner)
