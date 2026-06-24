/**
 * 命令路由器
 * 显式注册所有命令，禁止 if-else 链式分发
 * 解析消息内容，匹配命令前缀，调用对应处理器
 * 群组消息受白名单限制
 */
import { QqMessageEvent, sendMessage } from '../bot/adapter'
import { QQ_GROUP_WHITELIST } from '../config'
import { handleAsk } from './ask'
import { handleUpload } from './upload'
import { handleCheck } from './check'
import { handleLearn } from './learn'

/** 命令处理器：接收事件 + 命令参数，自行回复消息 */
type CommandHandler = (
  event: QqMessageEvent,
  args: string
) => Promise<void>

/** 命令注册表 */
const commandMap: Record<string, CommandHandler> = {
  '/ask': handleAsk,
  '/upload': handleUpload,
  '/check': handleCheck,
  '/learn': handleLearn,
  '/ping': pingHandler
}

/** /ping 连通测试 + 群信息诊断 */
async function pingHandler(
  event: QqMessageEvent,
  _args: string
): Promise<void> {
  let content = 'pong'
  // 群聊时附上群标识信息，方便配置白名单
  if (event.sourceType === 'group') {
    const groupId = event.groupId || '(无)'
    const groupOpenid = event.groupOpenid || '(无)'
    content =
      `pong!\n` +
      `本群 group_openid: ${groupOpenid}\n` +
      `本群 group_id: ${groupId}\n` +
      `请将 group_openid 填入 QQ_GROUP_WHITELIST`
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

/** 命令前缀识别正则 */
const COMMAND_REGEX = /^\/(ask|upload|check|learn|ping)\b/

/**
 * 首次收到某群消息时，打印其标识信息以方便配置白名单
 */
const loggedGroups = new Set<string>()
function logGroupInfo(event: QqMessageEvent): void {
  if (event.sourceType !== 'group' || !event.groupOpenid) {
    return
  }
  if (loggedGroups.has(event.groupOpenid)) {
    return
  }
  loggedGroups.add(event.groupOpenid)
  console.log(
    `[Router] 新群消息 | group_openid=${event.groupOpenid}` +
    ` | group_id=${event.groupId || '(无)'}`
  )
}

/**
 * 检查群组是否在白名单内
 * 支持 QQ 群号和 group_openid 两种匹配方式
 * 白名单为空时不限制；私聊不受限
 */
function isGroupAllowed(event: QqMessageEvent): boolean {
  // 私聊始终允许
  if (event.sourceType !== 'group') {
    return true
  }
  // 白名单为空则不限制
  if (QQ_GROUP_WHITELIST.size === 0) {
    return true
  }
  // 支持 QQ 群号匹配
  if (event.groupId && QQ_GROUP_WHITELIST.has(event.groupId)) {
    return true
  }
  // 支持 group_openid 匹配（兜底）
  if (event.groupOpenid && QQ_GROUP_WHITELIST.has(event.groupOpenid)) {
    return true
  }
  return false
}

/**
 * 路由入口，从 event 层调用
 * 解析消息内容中的命令并分发
 */
export async function routeMessage(event: QqMessageEvent): Promise<void> {
  const content = event.content.trim()
  const match = content.match(COMMAND_REGEX)
  if (!match) {
    return // 非命令消息，静默忽略
  }

  const commandName = match[0].trim()

  // 记录群信息（首次消息时打印到控制台）
  logGroupInfo(event)

  // 群组白名单检查（/ping 除外，用于诊断）
  if (commandName !== '/ping' && !isGroupAllowed(event)) {
    console.log(
      `[Router] 拦截非白名单群组消息: group_openid=${event.groupOpenid}`
    )
    return // 静默忽略
  }
  // 提取命令后面的参数（去掉命令本身）
  const args = content.slice(match[0].length).trim()
  const handler = commandMap[commandName]

  if (!handler) {
    // 理论上不会到这里，因为正则已限制命令范围
    await sendMessage({
      content: `未知命令: ${commandName}`,
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
    return
  }

  try {
    await handler(event, args)
  } catch (err) {
    const error = err as Error
    console.error(`[Router] 命令 ${commandName} 执行失败:`, error.message)
    // 向用户返回错误提示，但不暴露内部细节
    await sendMessage({
      content: '命令执行失败，请稍后重试。',
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
  }
}
