/**
 * 命令路由器
 * 显式注册所有命令，禁止 if-else 链式分发
 * 解析消息内容，匹配命令前缀，调用对应处理器
 * 群组消息受 QQ_GROUP_WHITELIST 限制，私聊受 QQ_USER_WHITELIST 限制
 * /ping 始终放行，用于诊断
 */
import { QqMessageEvent, QqInteractionEvent, sendMessage } from '../bot/adapter'
import { QQ_GROUP_WHITELIST, QQ_USER_WHITELIST, QQ_LEARN_WHITELIST } from '../config'
import { handleAsk } from './ask'
import { handleUpload } from './upload'
import { handleLearn } from './learn'
import { handleSearch } from './search'
import { handleList } from '../submissions/commands'
import { handleInteraction } from '../submissions/interact'

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
  '/search': handleSearch,
  '/ping': pingHandler,
  '/list': handleList
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

/** 命令前缀识别正则：匹配任意 /xxx 命令 */
const COMMAND_REGEX = /^\/(\S+)\b/

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
  const refContent = event.referencedContent || ''

  // 记录标识信息，方便配置白名单
  logGroupInfo(event)
  logUserInfo(event)

  // 群聊：仅 @bot 消息才响应（事件类型或 content 中携带 @ 标记）
  if (event.sourceType === 'group') {
    const isAtEvent = (
      event.eventType === 'GROUP_AT_MESSAGE_CREATE' ||
      event.eventType === 'AT_MESSAGE_CREATE'
    )
    const hasMention = /<@!?[^>]+>/.test(content)
    if (!isAtEvent && !hasMention) {
      console.log(
        `[Router] 群普通消息忽略 | content="${content.slice(0, 80)}"`
      )
      return
    }
  }

  // 去除 @机器人 前缀后再匹配命令
  const cleaned = content
    .replace(/<@!?[^>]+>\s*/g, '')
    .trim()
  const effective = cleaned || refContent

  // 移动端按钮兼容：QQ 移动端不支持键盘交互，会将回调数据作为文本发送
  // 在此拦截 claim:N / approve:N / reject:N 格式的消息并转发给交互处理器
  const callbackMatch = cleaned.match(/^(claim|approve|reject):(\d+)$/)
  if (callbackMatch) {
    const interaction: QqInteractionEvent = {
      id: event.id,
      type: 11,
      data: cleaned,
      userId: event.author.id,
      groupOpenid: event.groupOpenid,
      messageId: ''
    }
    handleInteraction(interaction)
    return
  }
  console.log(
    `[Router] content="${content.slice(0, 60)}" ` +
    `cleaned="${cleaned.slice(0, 60)}" ` +
    `ref="${refContent.slice(0, 30)}"`
  )
  if (!effective) return

  const match = cleaned.match(COMMAND_REGEX)
  if (match) {
    console.log(`[Router] 命令匹配: ${match[0]} -> ${'/' + match[1].toLowerCase()}`)
  }

  // 非命令消息
  if (!match) {
    // 群聊：仅 @bot /command 生效，纯文本不自动转 /ask
    if (event.sourceType === 'group') return

    // 私聊非白名单用户只允许 /ping 和 /upload 命令，纯文本不响应
    if (!isAllowed(event)) {
      console.log(
        `[Router] 拦截非白名单用户私聊: user_openid=${event.author.id}`
      )
      return
    }

    // 私聊：自动走 /ask
    console.log(`[Router] Chat: "${effective.slice(0, 50)}"`)
    try {
      await handleAsk(event, effective)
    } catch (err) {
      const error = err as Error & { response?: { status: number; data: unknown } }
      console.error('[Router] 对话执行失败:', error.message)
      if (error.response) {
        console.error(
          `[Router] 上游返回 ${error.response.status}:`,
          JSON.stringify(error.response.data)
        )
      }
      await sendMessage({
        content: '命令执行失败，请稍后重试。',
        sourceType: event.sourceType,
        groupOpenid: event.groupOpenid,
        userOpenid: event.author.id,
        channelId: event.channelId,
        messageId: event.id
      })
    }
    return
  }

  const commandName = '/' + match[1].toLowerCase()

  // 白名单检查（/ping 和 /upload 始终放行）
  if (commandName !== '/ping' && commandName !== '/upload' && !isAllowed(event)) {
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
  // 提取命令后面的参数（命令匹配基于 cleaned，去掉了 @bot 前缀）
  const args = cleaned.slice(match[0].length).trim()
  const handler = commandMap[commandName]

  if (!handler) {
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
    const error = err as Error & { response?: { status: number; data: unknown } }
    console.error(`[Router] 命令 ${commandName} 执行失败:`, error.message)
    if (error.response) {
      console.error(
        `[Router] 上游返回 ${error.response.status}:`,
        JSON.stringify(error.response.data)
      )
    }
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
