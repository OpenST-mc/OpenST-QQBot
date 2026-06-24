/**
 * 用户上下文管理器
 * 每个用户独立维护对话历史，互不干扰
 * 新用户自动创建空上下文，30 分钟无活动自动清理
 */
import { QqMessageEvent } from '../bot/adapter'

/** 上下文保留时间（毫秒），超时自动清除 */
const CONTEXT_TTL_MS = 30 * 60 * 1000
/** 每个用户最多保留的消息对数（一问一答算一对） */
const MAX_TURNS = 8

/** 对话消息 */
export interface ContextMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

/** 待学习追踪 */
export interface PendingLearn {
  /** 用户最初的问题 */
  topic: string
  /** 标记时间 */
  timestamp: number
}

/** 单个用户的上下文 */
interface UserContext {
  userId: string
  /** 用户标识名（用于日志） */
  username: string
  messages: ContextMessage[]
  lastActivity: number
  /** 是否等待用户补充知识 */
  pendingLearn: PendingLearn | null
}

/** 所有用户的上下文存储 */
const userContexts = new Map<string, UserContext>()

/** 定时清理过期上下文（每 5 分钟） */
setInterval(() => {
  const now = Date.now()
  for (const [userId, ctx] of userContexts) {
    if (now - ctx.lastActivity > CONTEXT_TTL_MS) {
      userContexts.delete(userId)
    }
  }
}, 5 * 60 * 1000)

/**
 * 从 QQ 消息事件中提取用户标识
 */
export function getUserId(event: QqMessageEvent): string {
  // 群聊使用 groupOpenid + author.id 组合作为上下文隔离键
  if (event.sourceType === 'group' && event.groupOpenid) {
    return `${event.groupOpenid}:${event.author.id}`
  }
  return event.author.id
}

/**
 * 获取或创建用户的对话上下文
 */
export function getContext(event: QqMessageEvent): ContextMessage[] {
  const userId = getUserId(event)
  const username = event.author.username || userId

  let ctx = userContexts.get(userId)
  if (!ctx) {
    ctx = {
      userId,
      username,
      messages: [],
      lastActivity: Date.now(),
      pendingLearn: null
    }
    userContexts.set(userId, ctx)
  } else {
    ctx.lastActivity = Date.now()
  }

  return ctx.messages
}

/**
 * 在当前用户的上下文中追加一轮对话
 */
export function appendContext(
  event: QqMessageEvent,
  userMessage: string,
  assistantMessage: string
): void {
  const userId = getUserId(event)
  const ctx = userContexts.get(userId)
  if (!ctx) {
    return
  }

  const now = Date.now()
  ctx.messages.push({ role: 'user', content: userMessage, timestamp: now })
  ctx.messages.push({
    role: 'assistant',
    content: assistantMessage,
    timestamp: now
  })
  ctx.lastActivity = now

  // 超过最大轮数时移除最早的对话
  const maxMessages = MAX_TURNS * 2
  while (ctx.messages.length > maxMessages) {
    ctx.messages.shift()
  }
}

/**
 * 设置待学习标记（AI 无法从数据库回答时调用）
 */
export function setPendingLearn(
  event: QqMessageEvent,
  topic: string
): void {
  const userId = getUserId(event)
  const ctx = userContexts.get(userId)
  if (!ctx) {
    return
  }
  ctx.pendingLearn = { topic, timestamp: Date.now() }
}

/**
 * 获取并清除待学习标记
 * 返回 null 表示没有待学习的知识
 */
export function consumePendingLearn(event: QqMessageEvent): PendingLearn | null {
  const userId = getUserId(event)
  const ctx = userContexts.get(userId)
  if (!ctx || !ctx.pendingLearn) {
    return null
  }
  const pending = ctx.pendingLearn
  ctx.pendingLearn = null
  return pending
}

/**
 * 清除指定用户的上下文（用于 /clear 等重置场景）
 */
export function clearContext(event: QqMessageEvent): void {
  const userId = getUserId(event)
  userContexts.delete(userId)
}

/**
 * 获取上下文摘要（用于日志）
 */
export function getContextSummary(event: QqMessageEvent): string {
  const userId = getUserId(event)
  const ctx = userContexts.get(userId)
  if (!ctx) {
    return `用户 ${userId}: 无上下文`
  }
  const turns = Math.floor(ctx.messages.length / 2)
  const learnStatus = ctx.pendingLearn ? ' (待学习)' : ''
  return `用户 ${userId} (${ctx.username}): ${turns} 轮对话, ${ctx.messages.length} 条消息${learnStatus}`
}
