/**
 * 对话学习服务
 * 支持两种模式：
 * 1. 被动学习：AI 无法回答 → 用户补充 → 自动提取知识
 * 2. 主动学习：用户 /ask 中直接传授知识 → 自动提取入库
 * 知识写入 public/database/database.md
 */
import fs from 'fs'
import { askAi } from './ai'

/** 学习数据路径 */
const LEARN_DB_PATH = 'public/database/database.md'

/** 知识共享关键词（检测用户是否在传授知识） */
const KNOWLEDGE_SHARING_PATTERNS = [
  '就是',
  '指的是',
  '应该算',
  '是一种',
  '请你理解',
  'Fun fact',
  '实际上',
  '请注意',
  '记住',
  '原理',
  '定义为',
  '意思是',
  '可以理解',
  '所属分类',
  '介绍如下',
  '定义',
  '其核心',
  '不同于',
  '而不是'
]

/**
 * 判断用户消息是否包含可学习知识
 * 条件：长度 > 80 字 + 包含知识共享关键词
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
 * @param userMessage 用户原始输入
 * @param aiResponse AI 的回复（帮助理解用户意图）
 */
export async function learnFromMessage(
  userMessage: string,
  aiResponse: string
): Promise<string | null> {
  const extractPrompt = `你是一个知识提取器。用户向助手发送了一条消息，助手的回复如下。

## 用户消息
${userMessage}

## 助手回复
${aiResponse.slice(0, 800)}

## 任务
如果用户消息中包含了可学习的 Minecraft 知识（术语定义、机器原理、设计概念、技巧等），
请提取成一段简洁的 markdown 格式说明（中文，100-300 字）。
格式示例：
\`\`\`
### [知识标题]
[简要说明]
\`\`\`

如果用户消息只是提问或闲聊，没有可学习的知识，只回复 "NONE"。`

  const summary = await askAi(extractPrompt, '请提取知识')

  if (!summary || summary.trim() === 'NONE') {
    return null
  }

  return appendToFile(summary.trim())
}

/**
 * 从对话上下文中提取知识（被动学习模式）
 * @param topic 用户最初的问题
 * @param recentMessages 最近几轮对话
 */
export async function learnFromContext(
  topic: string,
  recentMessages: string
): Promise<string | null> {
  const extractPrompt = `你是一个知识提取器。分析以下对话，提取用户提供的有效知识。

## 原始问题
${topic}

## 对话内容
${recentMessages}

## 任务
如果用户在对话中补充了有价值的 Minecraft 知识（如机器介绍、红石技巧、设计理念等），
请提取成一段简洁的 markdown 格式说明（中文，100-300 字）。
格式示例：
\`\`\`
### [知识标题]
[简要说明]
\`\`\`

如果用户没有补充任何有效知识，只回复 "NONE"。`

  const summary = await askAi(extractPrompt, '请提取知识')

  if (!summary || summary.trim() === 'NONE') {
    return null
  }

  return appendToFile(summary.trim())
}

/**
 * 写入 database.md
 */
function appendToFile(content: string): string | null {
  const timestamp = new Date().toISOString()
  const entry =
    `\n---\n` +
    `<!-- 学习于 ${timestamp} -->\n` +
    `${content}\n`

  try {
    if (!fs.existsSync(LEARN_DB_PATH)) {
      fs.writeFileSync(
        LEARN_DB_PATH,
        '# OpenST 知识学习库\n\n> 以下内容由社区对话自动学习生成\n',
        'utf-8'
      )
    }
    fs.appendFileSync(LEARN_DB_PATH, entry, 'utf-8')
    console.log(`[Learn] 知识已写入: ${content.slice(0, 80)}...`)
    return content
  } catch (err) {
    const error = err as Error
    console.error('[Learn] 写入失败:', error.message)
    return null
  }
}
