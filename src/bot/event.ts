/**
 * 事件分发器
 * 接收 QQ 适配层传来的事件，路由到对应处理器
 * 本层只负责转发，不做业务逻辑
 */
import { QqMessageEvent } from './adapter'

/** 消息处理器签名 */
export type MessageHandler = (event: QqMessageEvent) => Promise<void>

let handler: MessageHandler | null = null

/**
 * 注册全局消息事件处理器
 * 仅在启动时调用一次
 */
export function registerHandler(h: MessageHandler): void {
  handler = h
}

/**
 * 处理收到的 QQ 消息事件
 * 由 adapter 层调用
 */
export async function handleEvent(event: QqMessageEvent): Promise<void> {
  if (!handler) {
    console.warn('[Event] 未注册消息处理器')
    return
  }
  try {
    await handler(event)
  } catch (err) {
    const error = err as Error
    console.error('[Event] 消息处理失败:', error.message)
    // 错误在 router 层统一捕获，不抛出
  }
}
