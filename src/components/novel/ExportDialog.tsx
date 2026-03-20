'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Loader2, Download, FileText, BookOpen } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface Novel {
  id: string
  title: string
  description: string | null
  cover: string | null
  genre: string | null
  status: string
  wordCount: number
  chapters: { id: string; title: string; wordCount: number; order: number }[]
}

interface ExportDialogProps {
  novel: Novel
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ExportDialog({ novel, open, onOpenChange }: ExportDialogProps) {
  const [format, setFormat] = useState<'epub' | 'pdf'>('epub')
  const [includeCover, setIncludeCover] = useState(true)
  const [includeDescription, setIncludeDescription] = useState(true)
  const [fontSize, setFontSize] = useState('14')
  const [lineHeight, setLineHeight] = useState('1.8')
  const [isExporting, setIsExporting] = useState(false)

  const { toast } = useToast()

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          novelId: novel.id,
          format,
          includeCover,
          includeDescription,
          ...(format === 'pdf' ? {
            fontSize: parseInt(fontSize),
            lineHeight: parseFloat(lineHeight),
          } : {}),
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `导出失败: ${response.status}`)
      }

      // Blob 下载
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${novel.title}.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast({ title: `${format === 'epub' ? 'EPUB' : 'PDF'} 导出成功` })
      onOpenChange(false)
    } catch (error) {
      console.error('导出失败:', error)
      toast({
        title: error instanceof Error ? error.message : '导出失败，请重试',
        variant: 'destructive',
      })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5" />
            导出小说
          </DialogTitle>
          <DialogDescription>
            将《{novel.title}》导出为 {novel.chapters.length} 章的电子书
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 格式选择 */}
          <div className="space-y-2">
            <Label>导出格式</Label>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as 'epub' | 'pdf')}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="epub" id="export-epub" />
                <Label htmlFor="export-epub" className="flex items-center gap-2 cursor-pointer">
                  <BookOpen className="w-4 h-4 text-blue-500" />
                  EPUB（电子书阅读器）
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="pdf" id="export-pdf" />
                <Label htmlFor="export-pdf" className="flex items-center gap-2 cursor-pointer">
                  <FileText className="w-4 h-4 text-red-500" />
                  PDF（通用格式）
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* 通用选项 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>包含封面</Label>
              <Switch checked={includeCover} onCheckedChange={setIncludeCover} />
            </div>
            <div className="flex items-center justify-between">
              <Label>包含简介</Label>
              <Switch checked={includeDescription} onCheckedChange={setIncludeDescription} />
            </div>
          </div>

          {/* PDF 专属选项 */}
          {format === 'pdf' && (
            <div className="space-y-3 p-3 bg-muted/50 rounded-lg">
              <div className="space-y-2">
                <Label>字体大小</Label>
                <Select value={fontSize} onValueChange={setFontSize}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12">小（12pt）</SelectItem>
                    <SelectItem value="14">中（14pt）</SelectItem>
                    <SelectItem value="16">大（16pt）</SelectItem>
                    <SelectItem value="18">特大（18pt）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>行间距</Label>
                <Select value={lineHeight} onValueChange={setLineHeight}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1.5">紧凑（1.5）</SelectItem>
                    <SelectItem value="1.8">适中（1.8）</SelectItem>
                    <SelectItem value="2.0">宽松（2.0）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            取消
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                导出中...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                导出
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
