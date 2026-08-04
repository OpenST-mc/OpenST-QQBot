// /ask 命令处理器
// 流程：
// 1. 加载该用户的独立对话上下文 + 检查待学习标记
// 2. 匹配字典术语（public/database/raw/dictionary）+ CSV 词汇表
// 3. 将字典摘要注入 AI 系统提示词
// 4. 读取 agent/AGENTS.md 作为 AI 行为规则
// 5. 从本地 public/database/database.json 读取机器数据，按查询匹配候选机器
// 6. 调用 DeepSeek AI 生成回答（带该用户的历史上下文）
// 7. 如有机器推荐，拼接待推荐链接返回用户
// 8. 检测回答质量：若无匹配数据则标记待学习，并触发联网搜索补充
// 9. 保存本轮对话到用户上下文
import fs from 'fs'
import { QqMessageEvent, sendMessage, sendMarkdown } from '../bot/adapter'
import { askAiWithRecommendations, askAi } from '../services/ai'
import {
  loadGlossary,
  loadMachineDatabase,
  searchMachines,
  MachineEntry
} from '../services/data'
import { getAllZhEntries } from '../services/dictionary'
import { buildKnowledgeIndex, searchKnowledge, KnowledgeEntry } from '../services/embeddings'
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
import {
  AI_AGENT_PROMPT_PATH,
  SHARE_BASE_URL,
  SEARCH_IN_ASK,
  SEARCH_ENABLED,
  LEARN_CSV_PATH
} from '../config'
import { parseAttachments } from '../services/attachment'
import { searchSourceFiles } from '../services/source'
import { analyzeSource } from '../services/agent'
import { webSearch } from '../services/search'

// 不确定性关键词（AI 表示无法回答时的常用措辞）
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
  // 无文本参数时，尝试使用引用消息内容
  let argsFromRef = false
  if (!args) {
    if (event.referencedContent) {
      args = event.referencedContent
      argsFromRef = true
      console.log(`[Ask] 使用引用消息内容作为问题，长度: ${args.length}`)
    } else {
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

  // 附加文件搜索工具指令（主模型自行决定是否使用）
  systemPrompt +=
    '\n\n## 文件搜索\n' +
    '如果你需要查阅 public/database/source/ 目录下的文件来获取更准确的信息，\n' +
    '请在回复开头写 [SEARCH_SOURCE: 你的查询关键词]。\n' +
    '系统会搜索该目录下的文件并将内容返回给你，请你基于结果给出最终回答。\n' +
    '如果你不需要文件搜索结果，直接正常回答。'

  // 构建知识库索引并语义匹配
  let enrichedPrompt = args
  let matchedKnowledge: Array<KnowledgeEntry & { score: number }> = []
  try {
    const entries: KnowledgeEntry[] = []

    // 1. 词汇表（TechMC Glossary.csv）
    const glossary = loadGlossary()
    for (const g of glossary) {
      entries.push({ source: 'glossary', label: g.term, text: g.definition })
    }

    // 2. 词典（public/database/raw/dictionary/）
    const dictEntries = getAllZhEntries()
    for (const d of dictEntries) {
      entries.push({ source: 'dictionary', label: d.label, text: d.text })
    }

    // 3. 已学知识（database.csv）
    const learned = loadLearnedKnowledge()
    for (const l of learned) {
      entries.push({ source: 'learned', label: l.topic, text: l.content })
    }

    // 构建语义索引并搜索
    if (entries.length > 0) {
      await buildKnowledgeIndex(entries)
      matchedKnowledge = await searchKnowledge(args, 5)
    }
  } catch (err) {
    const error = err as Error
    console.warn('[Ask] 知识库语义搜索失败:', error.message)
  }

  // 拼接待匹配知识到 prompt
  if (matchedKnowledge.length > 0) {
    const formatted = matchedKnowledge.map((m) => {
      const tag = m.source === 'glossary' ? '词汇' : m.source === 'dictionary' ? '词典' : '知识'
      return `[${tag}] ${m.label}:\n${m.text}`
    })
    enrichedPrompt = `用户问题: ${args}\n\n参考知识:\n${formatted.join('\n\n')}`
    console.log(`[Ask] 语义知识匹配: ${matchedKnowledge.length} 条, top1=${matchedKnowledge[0].label} (score=${matchedKnowledge[0].score.toFixed(4)})`)
  }

  // 引用消息文本内容作为额外上下文（仅当 args 非引用自身时注入）
  if (event.referencedContent && !argsFromRef) {
    const refContext = `[引用消息内容]\n${event.referencedContent}`
    enrichedPrompt = enrichedPrompt
      ? `${refContext}\n\n---\n${enrichedPrompt}`
      : `${refContext}\n\n---\n${args}`
    console.log(`[Ask] 引用消息已注入 prompt，长度: ${event.referencedContent.length}`)
  }

  // 附件内容直接追加到用户问题末尾
  if (attachmentText) {
    enrichedPrompt = enrichedPrompt
      ? `${enrichedPrompt}\n\n---\n${attachmentText}`
      : `${args}\n\n---\n${attachmentText}`
    console.log(`[Ask] 附件已注入 prompt，内容前100字: ${attachmentText.slice(0, 100)}`)
  }

  // 加载本地机器数据库，按关键词匹配候选机器（不依赖 Sentence-BERT）
  let machines: MachineEntry[] = []
  let matchedMachines: MachineEntry[] = []
  try {
    machines = loadMachineDatabase()
    matchedMachines = searchMachines(args, machines)
  } catch (err) {
    const error = err as Error
    console.warn('[Ask] 机器数据库匹配失败:', error.message)
  }

  // 联网搜索注入（需 SEARCH_ENABLED=true 且 SEARCH_IN_ASK 未关闭）
  if (SEARCH_ENABLED && SEARCH_IN_ASK) {
    try {
      const searchResults = await webSearch(args)
      if (searchResults.length > 0) {
        const searchContext = searchResults
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`)
          .join('\n')
        enrichedPrompt = enrichedPrompt
          ? `[联网搜索结果]\n${searchContext}\n\n---\n${enrichedPrompt}`
          : `${args}\n\n[联网搜索结果]\n${searchContext}`
        console.log(
          `[Ask] 联网搜索结果已注入: ${searchResults.length} 条`
        )
      }
    } catch (err) {
      console.warn('[Ask] 联网搜索注入失败:', (err as Error).message)
    }
  }

  // 第一轮 AI 调用：主模型可能请求文件搜索
  let aiResult = await askAiWithRecommendations(
    systemPrompt,
    enrichedPrompt,
    machines,
    matchedMachines,
    history
  )

  // 检查主模型是否请求了文件搜索
  const searchTag = aiResult.answer.match(/\[SEARCH_SOURCE:\s*(.+?)\]/)
  if (searchTag) {
    const searchQuery = searchTag[1].trim()
    console.log(`[Ask] 主模型请求文件搜索: "${searchQuery}"`)

    try {
      const matchedFiles = searchSourceFiles(searchQuery)
      if (matchedFiles.length > 0) {
        console.log(`[Ask] 命中 ${matchedFiles.length} 个文件`)
        const analysis = await analyzeSource(searchQuery, matchedFiles)
        if (analysis) {
          // 将分析结果注入 prompt，第二次调用主模型
          const secondPrompt =
            `[文件分析结果]\n${analysis}\n\n---\n` +
            `用户原始问题: ${enrichedPrompt}`
          aiResult = await askAiWithRecommendations(
            systemPrompt,
            secondPrompt,
            machines,
            matchedMachines,
            history
          )
        }
      } else {
        console.log('[Ask] 未找到匹配的文件')
      }
    } catch (err) {
      const error = err as Error
      console.warn('[Ask] 文件搜索失败:', error.message)
    }
  }

  // 构建回复：AI 回答 + 推荐链接（完整 Markdown，QQ 原生支持）
  let reply = aiResult.answer
  if (aiResult.recommendations && aiResult.recommendations.length > 0) {
    reply += '\n\n---\n## 推荐链接\n'
    for (const subId of aiResult.recommendations) {
      reply += `- [${SHARE_BASE_URL}${subId}](${SHARE_BASE_URL}${subId})\n`
    }
  }

  // 检测 AI 回答是否表示数据不足
  const isUncertain =
    matchedMachines.length === 0 &&
    aiResult.recommendations.length === 0 &&
    UNCERTAINTY_PATTERNS.some((p) => reply.includes(p))

  if (isUncertain) {
    // 默认联网搜索已注入 prompt，此处仅作为关闭搜索时的回退
    let searched = false
    if (!SEARCH_IN_ASK && SEARCH_ENABLED) {
      try {
        const searchResults = await webSearch(args)
        if (searchResults.length > 0) {
          const searchContext = searchResults
            .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`)
            .join('\n\n')
          const retryPrompt =
            `用户问题: ${args}\n\n` +
            `以下是联网搜索结果，请基于这些信息重新回答用户问题:\n\n${searchContext}`
          const improvedAnswer = await askAi(
            systemPrompt,
            retryPrompt,
            'pro',
            history
          )
          if (improvedAnswer) {
            reply = improvedAnswer
            reply += '\n\n---\n## 搜索来源'
            for (let i = 0; i < searchResults.length; i++) {
              reply += `\n${i + 1}. [${searchResults[i].title}](${searchResults[i].url})`
            }
            searched = true
            console.log(
              `[Ask] 联网搜索补充完成: ${searchResults.length} 条结果`
            )
          }
        }
      } catch (err) {
        console.warn('[Ask] 联网搜索失败:', (err as Error).message)
      }
    }

    if (!searched) {
      setPendingLearn(event, args)
      reply +=
        '\n\n---\n如果你了解相关信息，欢迎补充！我会自动记录到知识库中。'
    }
    console.log(`[Ask] ${getContextSummary(event)}`)
  }

  // 主动学习检测
  if (isLearnableMessage(args)) {
    learnFromMessage(args, reply).then((result) => {
      if (result) {
        console.log(`[Ask] 主动学习完成: ${result.slice(0, 60)}...`)
      }
    }).catch((err: Error) => {
      console.warn('[Ask] 主动学习失败:', err.message)
    })
  }

  // 保存本轮对话到用户上下文
  appendContext(event, args, reply)

  // 直接发送 Markdown（QQ 原生支持）
  await sendMarkdown({
    markdownContent: reply,
    sourceType: event.sourceType,
    groupOpenid: event.groupOpenid,
    userOpenid: event.author.id,
    channelId: event.channelId,
    messageId: event.id
  })
}

// 加载已学知识库（database.csv），返回 topic,content 列表
function loadLearnedKnowledge(): Array<{ topic: string; content: string }> {
  if (!fs.existsSync(LEARN_CSV_PATH)) return []

  const raw = fs.readFileSync(LEARN_CSV_PATH, 'utf-8')
  const lines = raw.split('\n')
  if (lines.length < 2) return []

  const result: Array<{ topic: string; content: string }> = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const row = parseSimpleCsvLine(line)
    if (row && row.length >= 2) {
      result.push({ topic: row[0], content: row[1] })
    }
  }
  return result
}

// 简易 CSV 行解析（支持引号内逗号和转义引号）
function parseSimpleCsvLine(line: string): string[] | null {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        result.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  result.push(current)
  return result.length >= 2 ? result : null
}
