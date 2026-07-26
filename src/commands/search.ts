// /search 命令处理器
// 联网搜索 + 可选 AI 摘要
// 用法: /search <查询关键词>
// 也支持引用消息：回复某条消息并发送 /search（无参数），将搜索引用消息内容
import { QqMessageEvent, sendMessage, sendMarkdown } from '../bot/adapter'
import {
  webSearch,
  summarizeResults,
  SearchResult
} from '../services/search'
import { SEARCH_AI_SUMMARIZE, SEARCH_ENABLED } from '../config'

export async function handleSearch(
  event: QqMessageEvent,
  args: string
): Promise<void> {
  if (!SEARCH_ENABLED) {
    await sendMessage({
      content: '联网搜索功能暂未开放，请在 .env 中设置 SEARCH_ENABLED=true 开启。',
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
    return
  }
  // 解析查询文本：优先使用命令参数，其次使用引用消息内容
  let query = args
  let fromRef = false
  if (!query) {
    if (event.referencedContent) {
      query = event.referencedContent
      fromRef = true
      console.log(`[SearchCmd] 使用引用消息内容，长度: ${query.length}`)
    } else {
      await sendMessage({
        content:
          '请在 /search 后输入搜索关键词。\n' +
          '例: /search Minecraft 1.21 更新内容\n' +
          '也可以回复一条消息并发送 /search 来搜索该消息内容。',
        sourceType: event.sourceType,
        groupOpenid: event.groupOpenid,
        userOpenid: event.author.id,
        channelId: event.channelId,
        messageId: event.id
      })
      return
    }
  }

  if (query.length < 2) {
    await sendMessage({
      content: '搜索关键词太短，至少需要 2 个字符。',
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
    return
  }

  console.log(`[SearchCmd] 搜索: "${query.slice(0, 60)}"`)

  let results: SearchResult[] = []
  try {
    results = await webSearch(query)
  } catch {
    await sendMessage({
      content: '联网搜索失败，可能是网络问题或搜索服务不可用。请稍后重试。',
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
    return
  }

  if (results.length === 0) {
    await sendMessage({
      content: `没有找到与 "${query.slice(0, 40)}" 相关的搜索结果。`,
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
    return
  }

  // 构建 Markdown 回复
  let reply = `## 搜索: ${query.slice(0, 60)}`

  // AI 摘要（可选，默认开启）
  if (SEARCH_AI_SUMMARIZE) {
    try {
      const summary = await summarizeResults(query, results)
      if (summary) {
        reply += `\n\n**AI 摘要**\n${summary}`
      }
    } catch (err) {
      console.warn('[SearchCmd] AI 摘要失败，跳过显示摘要:', (err as Error).message)
    }
  }

  // 搜索结果列表
  reply += '\n\n---\n**搜索结果**'
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    reply += `\n\n${i + 1}. **[${r.title}](${r.url})**`
    if (r.snippet) {
      reply += `\n   ${Array.from(r.snippet).slice(0, 120).join('')}`
    }
  }

  reply +=
    `\n\n---\n共 ${results.length} 条结果` +
    (fromRef ? '（来源: 引用消息）' : '')

  await sendMarkdown({
    markdownContent: reply,
    sourceType: event.sourceType,
    groupOpenid: event.groupOpenid,
    userOpenid: event.author.id,
    channelId: event.channelId,
    messageId: event.id
  })
  console.log(`[SearchCmd] 返回 ${results.length} 条结果`)
}
