/**
 * 主入口
 * 启动 QQ Bot WebSocket 长连接 + 上传页面 Express 服务
 * ..env 文件在最早时机加载，保证 config.ts 能读取到环境变量
 */
import 'dotenv/config'
import { startWebSocket, healthCheck } from './bot/adapter'
import { handleEvent, registerHandler } from './bot/event'
import { routeMessage } from './commands/router'
import { startUploadServer } from './upload/server'
import { closeBrowser, warmupBrowser } from './services/render'

/**
 * 初始化并启动所有服务
 */
async function main(): Promise<void> {
  console.log('[Index] OpenST QQ Bot 启动中...')

  // 记录是否配置了关键凭证
  if (!process.env['QQ_APP_ID']) {
    console.warn('[Index] 警告: 未设置 QQ_APP_ID，请检查 .env 文件')
  }
  if (!process.env['QQ_APP_SECRET']) {
    console.warn('[Index] 警告: 未设置 QQ_APP_SECRET，请检查 .env 文件')
  }
  if (!process.env['DEEPSEEK_API_KEY']) {
    console.warn('[Index] 警告: 未设置 DEEPSEEK_API_KEY，/ask 命令将不可用')
  }

  // 注册全局消息处理器：事件 -> 路由 -> 命令
  registerHandler(routeMessage)

  // 启动上传页面服务
  startUploadServer()

  // 预热图片渲染浏览器
  warmupBrowser()

  // 启动前做连通性检查：获取 token -> 拉网关
  const ok = await healthCheck()
  if (!ok) {
    console.error('[Index] QQ API 连通性检查失败，请确认凭证和环境配置正确')
    console.error('[Index] Bot 将继续尝试连接...')
  }

  // 注册 QQ 适配层事件回调并启动 WebSocket 长连接
  const onEvent = handleEvent
  startWebSocket(onEvent)

  console.log('[Index] 所有服务已启动')
}

// 优雅退出
process.on('SIGINT', async () => {
  console.log('[Index] 收到退出信号')
  await closeBrowser()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('[Index] 收到终止信号')
  await closeBrowser()
  process.exit(0)
})

main().catch((err: Error) => {
  console.error('[Index] 启动失败:', err.message)
  process.exit(1)
})
