// 投稿审核模块入口
// 启动轮询监控 + 注册交互事件处理器
import { startPolling, stopPolling } from './monitor'
import { registerInteractionHandler } from '../bot/event'
import { handleInteraction } from './interact'
import { SUBMISSIONS_AC } from './config'

// 初始化投稿审核系统
export function initSubmissions(): void {
  if (!SUBMISSIONS_AC) {
    console.log('[Submissions] SUBMISSIONS_AC 未配置，审核系统未启用')
    return
  }

  // 注册交互事件处理器
  registerInteractionHandler(handleInteraction)

  // 启动轮询
  startPolling()

  console.log('[Submissions] 投稿审核系统已初始化')
}

// 停止审核系统
export function shutdownSubmissions(): void {
  stopPolling()
}
