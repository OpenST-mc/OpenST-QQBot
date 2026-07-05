/**
 * 命令路由器
 * 显式注册所有命令，禁止 if-else 链式分发
 * 解析消息内容，匹配命令前缀，调用对应处理器
 * 群组消息受 QQ_GROUP_WHITELIST 限制，私聊受 QQ_USER_WHITELIST 限制
 * /ping 始终放行，用于诊断
 */
import { QqMessageEvent, sendMessage } from '../bot/adapter'
import { QQ_GROUP_WHITELIST, QQ_USER_WHITELIST, QQ_LEARN_WHITELIST } from '../config'
import { handleAsk } from './ask'
import { handleUpload } from './upload'
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
  '/learn': handleLearn,
  '/ping': pingHandler
}

/** /ping 连通测试 + 标识信息诊断 */
async function pingHandler(
  event: QqMessageEvent,
  _args: string
): Promise<void> {
  let content = 'pong'
  if (event.sourceType === 'group') {
    const groupId = event.groupId || '(无)'
    const groupOpenid = event.groupOpenid || '(无)'
    content =
      `pong!\n` +
      `本群 group_openid: ${groupOpenid}\n` +
      `本群 group_id: ${groupId}\n` +
      `请将 group_openid 填入 QQ_GROUP_WHITELIST`
  } else {
    const userOpenid = event.author.id
    content =
      `pong!\n` +
      `你的 user openid: ${userOpenid}\n` +
      `请将 user openid 填入 QQ_USER_WHITELIST`
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
const COMMAND_REGEX = /^\/(ask|upload|learn|ping)\b/

/**
 * 首次收到私聊消息时，打印用户 openid 以方便配置白名单
 */
const loggedUsers = new Set<string>()
function logUserInfo(event: QqMessageEvent): void {
  if (event.sourceType !== 'c2c') {
    return
  }
  const userOpenid = event.author.id
  if (loggedUsers.has(userOpenid)) {
    return
  }
  loggedUsers.add(userOpenid)
  console.log(`[Router] 新私聊用户 | user_openid=${userOpenid}`)
}

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
 * 检查命令来源是否在白名单内
 * 群聊查 QQ_GROUP_WHITELIST，私聊查 QQ_USER_WHITELIST
 * 对应白名单为空时不限制
 */
function isAllowed(event: QqMessageEvent): boolean {
  if (event.sourceType === 'group') {
    if (QQ_GROUP_WHITELIST.size === 0) {
      return true
    }
    if (event.groupId && QQ_GROUP_WHITELIST.has(event.groupId)) {
      return true
    }
    if (event.groupOpenid && QQ_GROUP_WHITELIST.has(event.groupOpenid)) {
      return true
    }
    return false
  }
  // 私聊
  if (QQ_USER_WHITELIST.size === 0) {
    return true
  }
  return QQ_USER_WHITELIST.has(event.author.id)
}

/**
 * 检查 /learn 命令专用白名单
 * 支持群号、group_openid、用户 openid 匹配
 * 白名单为空时不限制
 */
function isLearnAllowed(event: QqMessageEvent): boolean {
  if (QQ_LEARN_WHITELIST.size === 0) {
    return true
  }
  if (QQ_LEARN_WHITELIST.has(event.author.id)) {
    return true
  }
  if (event.sourceType === 'group') {
    if (event.groupId && QQ_LEARN_WHITELIST.has(event.groupId)) {
      return true
    }
    if (event.groupOpenid && QQ_LEARN_WHITELIST.has(event.groupOpenid)) {
      return true
    }
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

  // 记录标识信息，方便配置白名单
  logGroupInfo(event)
  logUserInfo(event)

  // 非命令消息，静默忽略
  if (!match) {
    return
  }

  const commandName = match[0].trim()

  // 白名单检查（/ping 始终放行）
  if (commandName !== '/ping' && !isAllowed(event)) {
    if (event.sourceType === 'group') {
      console.log(
        `[Router] 拦截非白名单群组消息: group_openid=${event.groupOpenid}`
      )
    } else {
      console.log(
        `[Router] 拦截非白名单用户消息: user_openid=${event.author.id}`
      )
    }
    return
  }

  // /learn 专用白名单检查（独立于通用白名单）
  if (commandName === '/learn' && !isLearnAllowed(event)) {
    console.log(
      `[Router] 拦截非 learn 白名单用户: ${event.author.id}` +
      ` | group=${event.groupOpenid || '(私聊)'}`
    )
    return
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
