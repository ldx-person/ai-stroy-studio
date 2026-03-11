'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FileText, MoreVertical, PenTool, Trash2 } from 'lucide-react'

interface Novel {
  id: string
  title: string
  description: string | null
  cover: string | null
  genre: string | null
  status: string
  wordCount: number
  chapters: { id: string; title: string; wordCount: number; order: number }[]
  createdAt: string
  updatedAt: string
}

interface NovelCardProps {
  novel: Novel
  onClick: () => void
  onDelete: () => void
  onStatusChange: (status: string) => void
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'ongoing': return 'bg-green-500/10 text-green-500'
    case 'completed': return 'bg-blue-500/10 text-blue-500'
    default: return 'bg-yellow-500/10 text-yellow-500'
  }
}

function getStatusText(status: string) {
  switch (status) {
    case 'ongoing': return '连载中'
    case 'completed': return '已完结'
    default: return '草稿'
  }
}

export function NovelCard({ novel, onClick, onDelete, onStatusChange }: NovelCardProps) {
  return (
    <Card 
      className="group cursor-pointer hover:shadow-lg transition-all duration-300 hover:-translate-y-1 touch-manipulation"
      onClick={onClick}
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
                  onStatusChange('ongoing')
                }}
              >
                <Badge className="bg-green-500/10 text-green-500 text-[10px] mr-2">连载</Badge>
                标记为连载中
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={(e) => {
                  e.stopPropagation()
                  onStatusChange('completed')
                }}
              >
                <Badge className="bg-blue-500/10 text-blue-500 text-[10px] mr-2">完结</Badge>
                标记为已完结
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={(e) => {
                  e.stopPropagation()
                  onStatusChange('draft')
                }}
              >
                <Badge className="bg-yellow-500/10 text-yellow-500 text-[10px] mr-2">草稿</Badge>
                标记为草稿
              </DropdownMenuItem>
              <DropdownMenuItem 
                className="text-red-600"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
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
  )
}
