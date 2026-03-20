import PDFDocument from 'pdfkit'
import type { NovelExportData, ExportOptions, ExportResult } from './types'
import { textToParagraphs } from './text-formatting'
import path from 'path'
import fs from 'fs'

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89

function getFontPath(): string {
  return path.join(process.cwd(), 'public', 'fonts', 'NotoSansSC-Regular.ttf')
}

/**
 * 逐字符换行，适配 CJK 文本
 */
function wrapTextLines(
  text: string,
  doc: PDFDocument,
  fontSize: number,
  maxWidth: number
): string[] {
  const lines: string[] = []
  let currentLine = ''

  for (const char of text) {
    const testLine = currentLine + char
    const width = doc.fontSize(fontSize).widthOfString(testLine)
    if (width > maxWidth && currentLine.length > 0) {
      lines.push(currentLine)
      currentLine = char
    } else {
      currentLine = testLine
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines
}

export async function generatePdf(
  novel: NovelExportData,
  options: ExportOptions
): Promise<ExportResult> {
  const fontSize = options.fontSize || 14
  const lineHeight = options.lineHeight || 1.8
  const margin = options.pageMargin || 50
  const indent = fontSize * 2

  // 检查字体文件存在
  const fontPath = getFontPath()
  if (!fs.existsSync(fontPath)) {
    throw new Error('中文字体文件不存在，请确保 public/fonts/NotoSansSC-Regular.ttf 存在')
  }

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    autoFirstPage: false,
    info: {
      Title: novel.title,
      Author: 'AI Story Studio',
      Creator: 'AI Story Studio',
      Subject: novel.description || undefined,
    },
  })

  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))

  const contentWidth = PAGE_WIDTH - margin * 2

  // 注册中文字体
  doc.registerFont('Chinese', fontPath)

  // --- 封面页 ---
  doc.addPage()
  doc.font('Chinese')

  if (options.includeCover && novel.cover) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      const imageResponse = await fetch(novel.cover, { signal: controller.signal })
      clearTimeout(timeout)

      if (imageResponse.ok) {
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
        const maxCoverWidth = contentWidth * 0.6
        const maxCoverHeight = 300
        doc.image(
          imageBuffer,
          (PAGE_WIDTH - maxCoverWidth) / 2,
          margin + 50,
          { width: maxCoverWidth, fit: [maxCoverWidth, maxCoverHeight] }
        )
        doc.moveDown(2)
      }
    } catch (e) {
      console.error('[Export] 下载封面图片失败:', e)
    }
  }

  // 标题
  doc.fontSize(24)
    .text(novel.title, { align: 'center' })
    .moveDown(1.5)

  // 简介
  if (options.includeDescription && novel.description) {
    doc.fontSize(12)
      .fillColor('#666666')
      .text(novel.description, { align: 'center', lineGap: 6 })
      .moveDown(1)
    doc.fillColor('#000000')
  }

  // --- 各章节 ---
  for (const chapter of novel.chapters) {
    doc.addPage()
    doc.font('Chinese').fillColor('#000000')

    // 章节标题
    doc.fontSize(18)
      .text(chapter.title, { align: 'center' })
      .moveDown(1.5)

    // 章节内容
    doc.fontSize(fontSize)
    const paragraphs = textToParagraphs(chapter.content)

    for (const para of paragraphs) {
      const lines = wrapTextLines(para, doc, fontSize, contentWidth)

      for (let i = 0; i < lines.length; i++) {
        // 检查是否需要换页
        if (doc.y + fontSize * lineHeight > PAGE_HEIGHT - margin) {
          doc.addPage()
          doc.font('Chinese').fontSize(fontSize).fillColor('#000000')
        }

        const textX = margin + (i === 0 ? indent : 0)
        const textWidth = contentWidth - (i === 0 ? indent : 0)
        doc.text(lines[i], textX, doc.y, {
          width: textWidth,
          lineGap: fontSize * (lineHeight - 1),
          align: 'justify',
        })
      }

      doc.moveDown(0.5)
    }
  }

  doc.end()

  const buffer = await new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  return {
    buffer,
    filename: `${novel.title}.pdf`,
    contentType: 'application/pdf',
  }
}
