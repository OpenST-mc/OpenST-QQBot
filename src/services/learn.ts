/**
 * 对话学习服务
 * 支持两种模式：
 * 1. 被动学习：AI 无法回答 -> 用户补充 -> 自动提取知识
 * 2. 主动学习：用户 /ask 中直接传授知识 -> 自动提取入库
 * 知识写入 public/database/database.csv（topic,content 格式）
 */
import fs from 'fs'
import { askAi } from './ai'

/** 学习数据路径 */
const LEARN_DB_PATH = 'public/database/database.csv'
const CSV_HEADER = 'topic,content\n'

/** 知识共享关键词 */
const KNOWLEDGE_SHARING_PATTERNS = [
  '就是', '指的是', '应该算', '是一种', '请你理解',
  'Fun fact', '实际上', '请注意', '记住', '原理',
  '定义为', '意思是', '可以理解', '所属分类',
  '介绍如下', '定义', '其核心', '不同于', '而不是'
]

/**
 * 判断用户消息是否包含可学习知识
 */
export function isLearnableMessage(userInput: string): boolean {
  if (userInput.length < 80) {
    return false
  }
  const lower = userInput.toLowerCase()
  return KNOWLEDGE_SHARING_PATTERNS.some((p) => lower.includes(p.toLowerCase()))
}

/**
 * 从单条用户消息中提取知识（主动学习模式）
 */
export async function learnFromMessage(
  userMessage: string,
  aiResponse: string
): Promise<string | null> {
  const extractPrompt = `你是一个知识提取器。

## 用户消息
${userMessage}

## 助手回复
${aiResponse.slice(0, 800)}

## 任务
如果用户消息中包含了可学习的 Minecraft 知识，请用以下格式提取：
第一行: [知识标题]
第二行开始: [简要说明，中文，100-300字]

如果只是提问或闲聊，只回复 "NONE"。`

  const summary = await askAi(extractPrompt, '请提取知识')
  if (!summary || summary.trim() === 'NONE') {
    return null
  }
  return appendToCsv(parseTopicContent(summary.trim()))
}

/**
 * 从对话上下文中提取知识（被动学习模式）
 */
export async function learnFromContext(
  topic: string,
  recentMessages: string
): Promise<string | null> {
  const extractPrompt = `你是一个知识提取器。

## 原始问题
${topic}

## 对话内容
${recentMessages}

## 任务
如果对话中补充了有价值的 Minecraft 知识，请用以下格式提取：
第一行: [知识标题]
第二行开始: [简要说明，中文，100-300字]

如果没有有效知识，只回复 "NONE"。`

  const summary = await askAi(extractPrompt, '请提取知识')
  if (!summary || summary.trim() === 'NONE') {
    return null
  }
  return appendToCsv(parseTopicContent(summary.trim()))
}

/**
 * 从 AI 回复中解析 topic 和 content
 * 格式：第一行是 topic，其余是 content
 */
function parseTopicContent(raw: string): { topic: string; content: string } {
  const lines = raw.split('\n')
  const topic = lines[0]
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[【《]|[】》]$/g, '')
    .trim()
  const content = lines.slice(1).join('\n').trim()
  return { topic, content: content || topic }
}

/**
 * 写入 CSV 文件
 */
function appendToCsv(
  entry: { topic: string; content: string }
): string | null {
  // CSV 转义：用双引号包裹含逗号/引号/换行的字段
  const esc = (s: string) => {
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const row = `${esc(entry.topic)},${esc(entry.content)}\n`

  try {
    if (!fs.existsSync(LEARN_DB_PATH)) {
      fs.writeFileSync(LEARN_DB_PATH, CSV_HEADER + row, 'utf-8')
    } else {
      fs.appendFileSync(LEARN_DB_PATH, row, 'utf-8')
    }
    console.log(`[Learn] 知识已写入 CSV: ${entry.topic.slice(0, 40)}`)
    return entry.content
  } catch (err) {
    const error = err as Error
    console.error('[Learn] 写入 CSV 失败:', error.message)
    return null
  }
}
