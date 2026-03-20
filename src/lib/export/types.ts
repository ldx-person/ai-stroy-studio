export type ExportFormat = 'epub' | 'pdf'

export interface ExportOptions {
  format: ExportFormat
  novelId: string
  includeCover: boolean
  includeDescription: boolean
  // PDF-specific options
  fontSize?: number
  lineHeight?: number
  pageMargin?: number
}

export interface NovelExportData {
  id: string
  title: string
  description: string | null
  cover: string | null
  genre: string | null
  status: string
  chapters: {
    id: string
    title: string
    content: string
    order: number
  }[]
}

export interface ExportResult {
  buffer: Buffer
  filename: string
  contentType: string
}
