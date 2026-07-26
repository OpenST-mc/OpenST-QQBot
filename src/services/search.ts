/**
 * 联网搜索服务
 * 默认 DuckDuckGo Lite（免费无需 API key），可选 SearXNG JSON（配 SEARCH_CUSTOM_URL）
 */
import axios from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import fs from 'fs'
import path from 'path'
import { askAi } from './ai'
import { SEARCH_MAX_RESULTS, SEARCH_CUSTOM_URL, SEARCH_AI_SUMMARIZE } from '../config'

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** 复用 HTTPS_PROXY 环境变量 */
function getHttpsAgent(): HttpsProxyAgent | undefined {
  const proxyUrl = process.env['HTTPS_PROXY']
  if (proxyUrl) {
    console.log(`[Search] 通过代理: ${proxyUrl}`)
    return new HttpsProxyAgent(proxyUrl)
  }
  return undefined
}

/**
 * DuckDuckGo Lite —— 纯 HTML 表格，无需 JS，跨地区一致
 * https://lite.duckduckgo.com/lite/
 * 结构：<a class="result-link"> / <td class="result-snippet"> / <span class="link-text">
 */
async function searchDuckDuckGo(
  query: string,
  max: number
): Promise<SearchResult[]> {
  const resp = await axios.get('https://lite.duckduckgo.com/lite/', {
    params: { q: query },
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    timeout: 30000,
    httpsAgent: getHttpsAgent()
  })

  const html: string = resp.data
  const results: SearchResult[] = []

  // 调试：保存 HTML 到 tmp/ 便于排查
  try {
    const tmpDir = path.resolve('tmp')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    const safeQuery = query.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 30)
    const dumpPath = path.join(tmpDir, `ddg_${safeQuery}_${Date.now()}.html`)
    fs.writeFileSync(dumpPath, html, 'utf-8')
    console.log(`[Search] HTML 已保存: ${dumpPath}`)
  } catch { /* 忽略写入失败 */ }

  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const rows: string[] = []
  let trMatch: RegExpExecArray | null
  while ((trMatch = trRegex.exec(html)) !== null) {
    rows.push(trMatch[1])
  }

  const hasResultLink = html.includes('result-link')
  const hasResultSnippet = html.includes('result-snippet')
  console.log(
    `[Search] tr:${rows.length} result-link:${hasResultLink} ` +
    `result-snippet:${hasResultSnippet}`
  )

  for (let i = 0; i < rows.length && results.length < max; i++) {
    const linkMatch = rows[i].match(
      /<a[^>]*class=['"]result-link['"][^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i
    )
    if (!linkMatch) continue

    const rawUrl = linkMatch[1]
    let url = rawUrl
    const uddgMatch = rawUrl.match(/uddg=([^&]+)/)
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1])
    }
    const title = linkMatch[2]
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .trim()
    if (!title || !url) continue

    // 下一行：snippet（<td class="result-snippet">）
    let snippet = ''
    if (i + 1 < rows.length) {
      const snippetMatch = rows[i + 1].match(
        /<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i
      )
      if (snippetMatch) {
        snippet = snippetMatch[1]
          .replace(/<[^>]*>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .trim()
      }
    }

    results.push({ title, url, snippet })
  }

  console.log(
    `[Search] DuckDuckGo Lite 返回 ${results.length} 条结果 ` +
    `(HTML ${html.length} 字符)`
  )
  return results
}

/**
 * SearXNG JSON API（需配置 SEARCH_CUSTOM_URL）
 */
async function searchSearXNG(
  query: string,
  baseUrl: string,
  max: number
): Promise<SearchResult[]> {
  const resp = await axios.get(`${baseUrl}/search`, {
    params: { q: query, format: 'json', categories: 'general' },
    headers: { 'User-Agent': UA },
    timeout: 30000,
    httpsAgent: getHttpsAgent()
  })

  const data = resp.data as { results?: Array<Record<string, unknown>> }
  if (!data.results || !Array.isArray(data.results)) return []

  return data.results.slice(0, max).map((r) => ({
    title: String(r['title'] || ''),
    url: String(r['url'] || ''),
    snippet: String(r['content'] || r['snippet'] || '')
  }))
}

/**
 * 执行联网搜索
 * SEARCH_CUSTOM_URL 为空 → DuckDuckGo Lite
 * SEARCH_CUSTOM_URL 非空 → SearXNG
 */
export async function webSearch(query: string): Promise<SearchResult[]> {
  try {
    if (SEARCH_CUSTOM_URL) {
      console.log(`[Search] 使用 SearXNG: ${SEARCH_CUSTOM_URL}`)
      return await searchSearXNG(query, SEARCH_CUSTOM_URL, SEARCH_MAX_RESULTS)
    }

    console.log(`[Search] 使用 DuckDuckGo Lite`)
    return await searchDuckDuckGo(query, SEARCH_MAX_RESULTS)
  } catch (err) {
    const error = err as Error & { response?: { status: number } }
    console.error(`[Search] 搜索失败: ${error.message}`)
    if (error.response) {
      console.error(`[Search] HTTP ${error.response.status}`)
    }
    throw err
  }
}

/** AI 摘要系统提示词 */
const SUMMARY_PROMPT =
  '你是一个搜索结果摘要助手。根据用户的问题和搜索结果，用中文写一段简短的摘要，' +
  '控制在 300 字以内。只基于提供的搜索结果回答，不要编造信息。' +
  '如果搜索结果与问题不相关，直接说明。'

export async function summarizeResults(
  query: string,
  results: SearchResult[]
): Promise<string> {
  if (results.length === 0) return ''

  const resultsText = results
    .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`)
    .join('\n\n')

  const userPrompt =
    `用户问题: ${query}\n\n搜索结果:\n${resultsText}\n\n请用中文总结上述搜索结果。`

  try {
    const summary = await askAi(SUMMARY_PROMPT, userPrompt)
    console.log(`[Search] AI 摘要完成，${summary.length} 字符`)
    return summary
  } catch (err) {
    const error = err as Error
    console.warn(`[Search] AI 摘要失败: ${error.message}`)
    return ''
  }
}
