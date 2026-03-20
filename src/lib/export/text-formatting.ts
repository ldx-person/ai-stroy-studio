/**
 * HTML 转义
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 将纯文本转为 XHTML 段落（EPUB 用）
 * 双换行分段，单换行合并，中文首行缩进 2em
 */
export function textToHtmlParagraphs(text: string): string {
  if (!text.trim()) return ''

  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => {
      const joined = p.replace(/\n/g, '')
      return `<p class="para" style="text-indent:2em;">${escapeHtml(joined)}</p>`
    })
    .join('\n')
}

/**
 * 将纯文本转为段落数组（PDF 用）
 * 双换行分段，单换行合并
 */
export function textToParagraphs(text: string): string[] {
  if (!text.trim()) return []

  return text
    .split(/\n\n+/)
    .map(p => p.replace(/\n/g, '').trim())
    .filter(p => p.length > 0)
}
