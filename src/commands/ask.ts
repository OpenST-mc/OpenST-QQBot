/**
 * /ask 命令处理器
 * 流程：
 * 1. 加载该用户的独立对话上下文 + 检查待学习标记
 * 2. 匹配字典术语（src/dictionary）+ CSV 词汇表
 * 3. 将字典摘要注入 AI 系统提示词
 * 4. 读取 agent/AGENTS.md 作为 AI 行为规则
 * 5. 从本地 public/database/database.json 读取机器数据，按查询匹配候选机器
 * 6. 调用 DeepSeek AI 生成回答（带该用户的历史上下文）
 * 7. 如有机器推荐，拼接待推荐链接返回用户
 * 8. 检测回答质量：若无匹配数据则标记待学习，下次用户补充知识时自动录入
 * 9. 保存本轮对话到用户上下文
 */
import fs from 'fs'
import { QqMessageEvent, sendMessage, sendImage } from '../bot/adapter'
import { askAiWithRecommendations } from '../services/ai'
import {
  loadGlossary,
  matchGlossaryTerms,
  loadMachineDatabase,
  searchMachines,
  MachineEntry
} from '../services/data'
import { matchDictionaryTerms, getAllTermSummaries } from '../services/dictionary'
import {
  getContext,
  appendContext,
  getContextSummary,
  setPendingLearn,
  consumePendingLearn
} from '../services/context'
import {
  learnFromContext,
  learnFromMessage,
  isLearnableMessage
} from '../services/learn'
import { AI_AGENT_PROMPT_PATH, SHARE_BASE_URL } from '../config'
import { renderMarkdownToImage } from '../services/render'
import { parseAttachments } from '../services/attachment'

/** 不确定性关键词（AI 表示无法回答时的常用措辞） */
const UNCERTAINTY_PATTERNS = [
  '数据库中没有',
  '暂无相关',
  '没有找到',
  '未能找到',
  '无法找到',
  '尚未收录',
  '我不确定',
  '目前没有',
  '未收录',
  '暂未收录'
]

export async function handleAsk(
  event: QqMessageEvent,
  args: string
): Promise<void> {
  if (!args) {
    await sendMessage({
      content: '请在 /ask 后输入你的问题。\n例: /ask 推荐一台生电机器\n也支持先发 /ask 再发文本文件。',
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
    return
  }

  // 获取该用户的对话上下文
  const history = getContext(event)
  console.log(`[Ask] ${getContextSummary(event)}`)

  // 解析消息中的附件（优先引用消息的附件）
  let attachmentText = ''
  const attToParse =
    event.referencedAttachments.length > 0
      ? event.referencedAttachments
      : event.attachments || []
  if (attToParse.length > 0) {
    try {
      attachmentText = await parseAttachments(attToParse)
      if (attachmentText) {
        console.log(`[Ask] 附件解析完成: ${attachmentText.length} 字符`)
      }
    } catch (err) {
      const error = err as Error
      console.warn('[Ask] 附件解析失败:', error.message)
    }
  }

  // 检查是否有待学习标记
  const pendingLearn = consumePendingLearn(event)
  if (pendingLearn && args.length > 30) {
    const recentSummary = history
      .slice(-6)
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n')
    const learned = await learnFromContext(pendingLearn.topic, recentSummary)
    if (learned) {
      console.log(`[Ask] 对话学习完成: ${pendingLearn.topic}`)
    }
  }

  // 加载系统提示词（agent/AGENTS.md）
  let systemPrompt = '你是一个 Minecraft 机器推荐助手。'
  try {
    systemPrompt = fs.readFileSync(AI_AGENT_PROMPT_PATH, 'utf-8')
  } catch {
    console.warn('[Ask] 未找到 agent/AGENTS.md，使用默认提示词')
  }

  // 注入字典知识库摘要到系统提示词
  try {
    const summaries = getAllTermSummaries()
    if (summaries) {
      systemPrompt += '\n\n' + summaries
    }
  } catch (err) {
    const error = err as Error
    console.warn('[Ask] 字典摘要加载失败:', error.message)
  }

  // 匹配术语并拼接到用户问题中
  let enrichedPrompt = args
  const contextParts: string[] = []

  // CSV 词汇表匹配
  try {
    const glossary = loadGlossary()
    const matched = matchGlossaryTerms(args, glossary)
    if (matched.length > 0) {
      const glossaryInfo = matched
        .map((e) => `[词汇] ${e.term}: ${e.definition}`)
        .join('\n')
      contextParts.push(glossaryInfo)
    }
  } catch (err) {
    const error = err as Error
    console.warn('[Ask] 词汇表加载失败:', error.message)
  }

  // 字典词条匹配（Storage Tech Dictionary）
  try {
    const dictEntries = matchDictionaryTerms(args)
    if (dictEntries.length > 0) {
      const dictInfo = dictEntries
        .map(
          (e) =>
            `[词典] ${e.termsZh} (${e.terms.join(' / ')}):\n${e.definitionZh}`
        )
        .join('\n\n')
      contextParts.push(dictInfo)
    }
  } catch (err) {
    const error = err as Error
    console.warn('[Ask] 字典匹配失败:', error.message)
  }

  // 拼接上下文到用户问题
  const allParts: string[] = []
  if (contextParts.length > 0) {
    allParts.push(`参考知识:\n${contextParts.join('\n\n')}`)
  }
  // 已学知识匹配（database.md）
  try {
    const learned = searchLearnedKnowledge(args)
    if (learned) {
      allParts.push(`以下是从社区学到的相关知识:\n\n${learned}`)
    }
  } catch (err) {
    const error = err as Error
    console.warn('[Ask] 学习知识检索失败:', error.message)
  }
  if (allParts.length > 0) {
    enrichedPrompt =
      `用户问题: ${args}\n\n` + allParts.join('\n\n')
  }
  // 附件内容直接追加到用户问题末尾
  if (attachmentText) {
    enrichedPrompt = enrichedPrompt
      ? `${enrichedPrompt}\n\n---\n${attachmentText}`
      : `${args}\n\n---\n${attachmentText}`
    console.log(`[Ask] 附件已注入 prompt，内容前100字: ${attachmentText.slice(0, 100)}`)
  }

  // 加载本地机器数据库，并按查询匹配候选机器
  let machines: MachineEntry[] = []
  let matchedMachines: MachineEntry[] = []
  try {
    machines = loadMachineDatabase()
    matchedMachines = searchMachines(args, machines)
  } catch (err) {
    const error = err as Error
    console.warn('[Ask] 机器数据库加载失败:', error.message)
  }

  // 调用 AI（传入该用户的历史上下文）
  const aiResult = await askAiWithRecommendations(
    systemPrompt,
    enrichedPrompt,
    machines,
    matchedMachines,
    history
  )

  // 构建回复：AI 回答 + 推荐链接（保留完整 Markdown）
  let reply = aiResult.answer
  let linksText = ''
  if (aiResult.recommendations && aiResult.recommendations.length > 0) {
    reply += '\n\n---\n## 推荐链接\n'
    for (const subId of aiResult.recommendations) {
      reply += `- [${SHARE_BASE_URL}${subId}](${SHARE_BASE_URL}${subId})\n`
      linksText += `${SHARE_BASE_URL}${subId}\n`
    }
  }

  // 检测 AI 回答是否表示数据不足
  const isUncertain =
    matchedMachines.length === 0 &&
    aiResult.recommendations.length === 0 &&
    UNCERTAINTY_PATTERNS.some((p) => reply.includes(p))

  if (isUncertain) {
    setPendingLearn(event, args)
    console.log(`[Ask] ${getContextSummary(event)}`)
    reply +=
      '\n\n---\n如果你了解相关信息，欢迎补充！我会自动记录到知识库中。'
  }

  // 主动学习检测
  if (isLearnableMessage(args)) {
    learnFromMessage(args, reply).then((result) => {
      if (result) {
        console.log(`[Ask] 主动学习完成: ${result.slice(0, 60)}...`)
      }
    })
  }

  // 保存本轮对话到用户上下文
  appendContext(event, args, reply)

  // 渲染 Markdown 为图片并发送（仅群聊和私聊支持图片）
  if (event.sourceType !== 'channel') {
    try {
      const imageBuffer = await renderMarkdownToImage(reply)
      await sendImage({
        imageBuffer,
        sourceType: event.sourceType,
        groupOpenid: event.groupOpenid,
        userOpenid: event.author.id,
        messageId: event.id
      })

      // 追发可点击链接
      if (linksText) {
        await sendMessage({
          content: '链接:\n' + linksText.trim(),
          sourceType: event.sourceType,
          groupOpenid: event.groupOpenid,
          userOpenid: event.author.id,
          channelId: event.channelId,
          messageId: event.id
        })
      }
    } catch (renderErr) {
      // 渲染或发送失败，回退文字
      const error = renderErr as Error
      console.error('[Ask] 图片发送失败，回退文字:', error.message)
      await sendTextFallback(event, aiResult.answer, linksText)
    }
  } else {
    await sendTextFallback(event, aiResult.answer, linksText)
  }
}

/**
 * 文字回退发送
 */
async function sendTextFallback(
  event: QqMessageEvent,
  answer: string,
  links: string
): Promise<void> {
  // 去掉 AI 回复中的 Markdown 标记，链接转为纯 URL
  let content = answer
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, '$2')   // [text](url) → url
    .replace(/\*\*(.+?)\*\*/g, '$1')              // **bold** → bold
    .replace(/`([^`]+)`/g, '$1')                  // `code` → code
    .replace(/^#{1,6}\s+/gm, '')                  // ## heading → heading
    .replace(/^---+\s*$/gm, '')                   // --- → 空
    .replace(/^>\s?/gm, '')                       // > quote
    .replace(/~~(.+?)~~/g, '$1')                  // ~~strike~~
    .replace(/\n{4,}/g, '\n\n')                   // 多余空行
    .trim()

  if (links) {
    content += '\n\n链接:\n' + links.trim()
  }
  // QQ 文本消息限制 4000
  if (content.length > 4000) {
    content = content.slice(0, 3990) + '\n...(已截断)'
  }
  await sendMessage({
    content,
    sourceType: event.sourceType,
    groupOpenid: event.groupOpenid,
    userOpenid: event.author.id,
    channelId: event.channelId,
    messageId: event.id
  })
}

/** 学习知识库路径 */
const LEARN_PATH = 'public/database/database.md'

/**
 * 按用户查询关键词搜索 database.md 中的匹配条目
 * 按 --- 分割条目，匹配度高的优先，返回 top 3
 */
function searchLearnedKnowledge(query: string): string {
  if (!fs.existsSync(LEARN_PATH)) {
    return ''
  }
  const raw = fs.readFileSync(LEARN_PATH, 'utf-8')

  // 按 --- 分割为条目，但跳过 frontmatter 中的 ---（紧随 title/tags 行后的）
  const sections = raw.split(/\n---\n/)
  if (sections.length <= 1) {
    return ''
  }

  const lowerQuery = query.toLowerCase()
  const scored: Array<{ text: string; score: number }> = []
  for (let i = 1; i < sections.length; i++) {
    let section = sections[i]

    // 如果前一个 section 以文件头结束且当前是 title 行，说明是 frontmatter
    // 这种情况合并回前一个 section
    if (section.startsWith('title:') || section.startsWith('tags:')) {
      continue // frontmatter 行，随上一个 section 一起被跳过
    }

    // 清除注释
    const cleaned = section
      .replace(/<!--.*?-->/g, '')
      .trim()
    if (!cleaned) continue
    if (cleaned.startsWith('> ')) continue

    // 去除附件上传的提示头和图片引用
    const readable = cleaned
      .replace(/^\[附件内容\]\s*/gm, '')
      .replace(/^以下为用户上传的.*?的内容:\s*$/gm, '')
      .replace(/!\[.*?\]\(.*?\)/g, '')          // 去掉 ![](...) 图片引用
      .replace(/title:.*\n?/g, '')               // 去掉 frontmatter title
      .replace(/tags:.*\n?/g, '')                // 去掉 frontmatter tags
      .replace(/^\s*-{3,}\s*$/gm, '')            // 去掉残余的单独 --- 行
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (!readable) continue

    // 按关键词匹配打分
    const lowerSec = readable.toLowerCase()
    let score = 0
    const words = lowerQuery.split(/[\s,，。！？、]+/).filter(w => w.length > 1)
    for (const w of words) {
      if (lowerSec.includes(w)) score += 3
    }

    if (score > 0) {
      scored.push({ text: readable, score })
    }
  }

  if (scored.length === 0) {
    return ''
  }

  // 按分数降序取 top 3
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, 3)
  const result = top.map((s) => s.text).join('\n\n---\n\n')

  console.log(
    `[Ask] 学习知识匹配: ${top.length} 条` +
    `（最高分 ${top[0].score}），共 ${result.length} 字符`
  )
  return result
}
