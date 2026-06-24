/**
 * Markdown 转图片渲染服务
 * 使用 marked 解析 MD → HTML → Puppeteer 截图 → PNG Buffer
 */
import { marked } from 'marked'
import puppeteer, { Browser } from 'puppeteer'

/** HTML 模板，CSS 适配移动端宽度 */
function buildHtml(markdownContent: string): string {
  const bodyHtml = marked.parse(markdownContent) as string
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
    font-size: 15px; line-height: 1.7; color: #1a1a1a;
    background: #ffffff; padding: 20px 18px; max-width: 480px;
    word-break: break-word;
  }
  h1 { font-size: 20px; margin: 16px 0 8px; color: #111; }
  h2 { font-size: 18px; margin: 14px 0 6px; color: #222; }
  h3 { font-size: 16px; margin: 12px 0 6px; color: #333; }
  p { margin: 6px 0; }
  ul, ol { padding-left: 22px; margin: 6px 0; }
  li { margin: 2px 0; }
  strong { color: #d4380d; }
  code {
    background: #f5f5f5; padding: 1px 4px; border-radius: 3px;
    font-family: "Cascadia Code", monospace; font-size: 13px;
  }
  pre {
    background: #f0f0f0; padding: 10px 12px; border-radius: 6px;
    overflow-x: auto; margin: 8px 0; font-size: 12px; line-height: 1.5;
  }
  pre code { background: none; padding: 0; }
  a { color: #1677ff; text-decoration: underline; }
  blockquote {
    border-left: 3px solid #ddd; padding-left: 10px;
    margin: 8px 0; color: #555;
  }
  hr { border: none; border-top: 1px solid #eee; margin: 12px 0; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  th { background: #f5f5f5; }
  img { max-width: 100%; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`
}

/** 浏览器实例（复用） */
let browserInstance: Browser | null = null
/** 浏览器是否预热完成 */
let browserReady = false

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) {
    return browserInstance
  }
  console.log('[Render] 正在启动 Chromium（首次启动需下载，约 300MB）...')
  try {
    browserInstance = await puppeteer.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ],
      headless: true
    })
    console.log('[Render] Chromium 启动成功')
    return browserInstance
  } catch (err) {
    const error = err as Error
    console.error('[Render] Chromium 启动失败:', error.message)
    throw err
  }
}

/**
 * 预热浏览器：在 startup 时调用，提前下载并启动 Chromium
 */
export async function warmupBrowser(): Promise<void> {
  try {
    await getBrowser()
    browserReady = true
    console.log('[Render] 浏览器预热完成')
  } catch (err) {
    const error = err as Error
    console.error('[Render] 浏览器预热失败，/ask 将回退到文字模式:', error.message)
  }
}

/**
 * 将 Markdown 文本渲染为 PNG 图片 Buffer
 */
export async function renderMarkdownToImage(
  markdown: string
): Promise<Buffer> {
  if (!browserReady && !browserInstance) {
    throw new Error('浏览器未就绪')
  }

  const html = buildHtml(markdown)
  const browser = await getBrowser()

  let page
  try {
    page = await browser.newPage()
    await page.setViewport({ width: 500, height: 100, deviceScaleFactor: 2 })
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 })

    // 等一小段确保字体渲染完成
    await new Promise((r) => setTimeout(r, 300))

    const bodyHeight = await page.evaluate(() => {
      return Math.max(document.body.scrollHeight, 100)
    })

    await page.setViewport({
      width: 500,
      height: Math.ceil(bodyHeight) + 20,
      deviceScaleFactor: 2
    })

    const buffer = await page.screenshot({ type: 'png', fullPage: true })
    console.log(`[Render] 图片生成成功, ${buffer.length} bytes`)
    return Buffer.from(buffer)
  } finally {
    if (page) {
      await page.close().catch(() => {})
    }
  }
}

/**
 * 清理浏览器实例
 */
export async function closeBrowser(): Promise<void> {
  browserReady = false
  if (browserInstance) {
    await browserInstance.close()
    browserInstance = null
  }
}
