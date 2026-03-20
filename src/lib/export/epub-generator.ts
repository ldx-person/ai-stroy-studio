import JSZip from 'jszip'
import type { NovelExportData, ExportOptions, ExportResult } from './types'
import { textToHtmlParagraphs, escapeHtml } from './text-formatting'

const EPUB_CSS = `
body {
  font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Source Han Sans SC", sans-serif;
  font-size: 1em;
  line-height: 1.8;
  margin: 1em;
  color: #333;
}
h1 { text-align: center; font-size: 1.5em; margin-bottom: 1em; }
h2 { text-align: center; font-size: 1.3em; margin-bottom: 1.5em; page-break-before: always; }
h2:first-of-type { page-break-before: auto; }
.para { text-indent: 2em; margin-bottom: 0.5em; }
.cover-image { text-align: center; margin: 2em 0; }
.cover-image img { max-width: 100%; height: auto; }
.description { margin: 1.5em 0; font-style: italic; color: #555; }
`

function chapterXhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h2>${escapeHtml(title)}</h2>
  ${body}
</body>
</html>`
}

function titlePageHtml(
  novel: NovelExportData,
  options: ExportOptions,
  coverImageFilename: string | null
): string {
  let coverHtml = ''
  if (coverImageFilename) {
    coverHtml = `<div class="cover-image"><img src="images/${coverImageFilename}" alt="${escapeHtml(novel.title)}"/></div>`
  }

  let descriptionHtml = ''
  if (options.includeDescription && novel.description) {
    descriptionHtml = `<div class="description"><p>${escapeHtml(novel.description)}</p></div>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeHtml(novel.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  ${coverHtml}
  <h1>${escapeHtml(novel.title)}</h1>
  ${descriptionHtml}
</body>
</html>`
}

export async function generateEpub(
  novel: NovelExportData,
  options: ExportOptions
): Promise<ExportResult> {
  const zip = new JSZip()

  // 1. mimetype（必须第一个，不压缩）
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

  // 2. META-INF/container.xml
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)

  // 3. CSS
  zip.file('OEBPS/style.css', EPUB_CSS)

  // 4. 封面图片
  let coverImageFilename: string | null = null
  if (options.includeCover && novel.cover) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      const imageResponse = await fetch(novel.cover, { signal: controller.signal })
      clearTimeout(timeout)

      if (imageResponse.ok) {
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg'
        const ext = contentType.includes('png') ? 'png' : 'jpg'
        coverImageFilename = `cover.${ext}`
        zip.file(`OEBPS/images/${coverImageFilename}`, imageBuffer)
      }
    } catch (e) {
      console.error('[Export] 下载封面图片失败:', e)
    }
  }

  // 5. 章节 XHTML 文件
  const manifestItems: string[] = []
  const spineItems: string[] = []
  const tocEntries: string[] = []

  // 封面页
  zip.file('OEBPS/title-page.xhtml', titlePageHtml(novel, options, coverImageFilename))
  manifestItems.push(`<item id="title-page" href="title-page.xhtml" media-type="application/xhtml+xml"/>`)
  spineItems.push(`<itemref idref="title-page"/>`)

  // 各章节
  novel.chapters.forEach((chapter, index) => {
    const filename = `chapter-${String(index + 1).padStart(3, '0')}.xhtml`
    const body = textToHtmlParagraphs(chapter.content)
    const html = chapterXhtml(chapter.title, body)
    zip.file(`OEBPS/${filename}`, html)

    const itemId = `chapter-${index + 1}`
    manifestItems.push(`<item id="${itemId}" href="${filename}" media-type="application/xhtml+xml"/>`)
    spineItems.push(`<itemref idref="${itemId}"/>`)
    tocEntries.push(`<navPoint id="navpoint-${index + 1}" playOrder="${index + 2}">
      <navLabel><text>${escapeHtml(chapter.title)}</text></navLabel>
      <content src="${filename}"/>
    </navPoint>`)
  })

  // 图片 manifest 项
  if (coverImageFilename) {
    const mediaType = coverImageFilename.endsWith('png') ? 'image/png' : 'image/jpeg'
    manifestItems.push(`<item id="cover-image" href="images/${coverImageFilename}" media-type="${mediaType}" properties="cover-image"/>`)
  }

  // 6. content.opf
  const uniqueId = `urn:uuid:${novel.id}`
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${uniqueId}</dc:identifier>
    <dc:title>${escapeHtml(novel.title)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:creator>AI Story Studio</dc:creator>
    ${novel.description ? `<dc:description>${escapeHtml(novel.description)}</dc:description>` : ''}
    ${coverImageFilename ? `<meta property="cover-image" refines="#cover-image"/>` : ''}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="style.css" media-type="text/css"/>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join('\n    ')}
  </spine>
</package>`)

  // 7. toc.ncx
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${uniqueId}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeHtml(novel.title)}</text></docTitle>
  <navMap>
    <navPoint id="navpoint-0" playOrder="1">
      <navLabel><text>封面</text></navLabel>
      <content src="title-page.xhtml"/>
    </navPoint>
    ${tocEntries.join('\n    ')}
  </navMap>
</ncx>`)

  // 8. nav.xhtml（EPUB 3 导航）
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>目录</title></head>
<body>
  <nav epub:type="toc">
    <h1>目录</h1>
    <ol>
      <li><a href="title-page.xhtml">封面</a></li>
      ${novel.chapters.map((ch, i) => `<li><a href="chapter-${String(i + 1).padStart(3, '0')}.xhtml">${escapeHtml(ch.title)}</a></li>`).join('\n      ')}
    </ol>
  </nav>
</body>
</html>`)

  const buffer = await zip.generateAsync({ type: 'nodebuffer' })

  return {
    buffer,
    filename: `${novel.title}.epub`,
    contentType: 'application/epub+zip',
  }
}
