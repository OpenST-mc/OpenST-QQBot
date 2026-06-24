/**
 * QQ Bot API 适配层
 * 封装所有 QQ API 的底层通信（WebSocket 长连接 + HTTP 短请求）
 * 核心业务系统不直接依赖 QQ 协议格式，均通过本层转换
 */
import axios from 'axios'
import { WebSocket } from 'ws'
import {
  QQ_API_BASE,
  QQ_TOKEN_URL,
  QQ_APP_ID,
  QQ_APP_SECRET
} from '../config'

/** QQ 消息事件类型 */
export interface QqMessageEvent {
  id: string
  author: { id: string; username?: string }
  content: string
  channelId: string
  guildId?: string
  groupOpenid?: string
  /** QQ 群号（仅在群聊事件中有效） */
  groupId?: string
  timestamp: string
  /** 消息来源类型：私聊 / 群聊 / 频道 */
  sourceType: 'c2c' | 'group' | 'channel'
  /** 本消息的附件列表 */
  attachments: QqAttachment[]
  /** 被引用消息的附件列表（回复/引用消息时） */
  referencedAttachments: QqAttachment[]
}

/** 附件信息 */
export interface QqAttachment {
  /** 附件 URL（用于下载） */
  url: string
  /** 内容类型，如 image/png, image/jpeg */
  contentType: string
  /** 文件名 */
  filename?: string
  /** 文件大小（字节） */
  size?: number
}

/** 发送消息的参数 */
export interface SendMessageParams {
  content: string
  /** 对于群聊回复，需要传入消息 ID */
  messageId?: string
  /** 对于私聊，传入用户 openid */
  userOpenid?: string
  /** 对于频道，传入频道 id */
  channelId?: string
  /** 对于群聊，传入群 openid */
  groupOpenid?: string
  /** 消息来源类型 */
  sourceType: 'c2c' | 'group' | 'channel'
}

/** WebSocket 操作码 */
const enum OpCode {
  DISPATCH = 0,
  HEARTBEAT = 1,
  IDENTIFY = 2,
  RESUME = 6,
  RECONNECT = 7,
  INVALID_SESSION = 9,
  HELLO = 10,
  HEARTBEAT_ACK = 11
}

let accessToken = ''
let tokenExpireTime = 0

/** 按目标（群/用户）维护消息序列号，防止 QQ 去重 */
const msgSeqMap = new Map<string, number>()

function nextMsgSeq(targetKey: string): number {
  const current = msgSeqMap.get(targetKey) || 0
  const next = current + 1
  msgSeqMap.set(targetKey, next)
  return next
}

/**
 * 获取 QQ Bot access_token
 * token 有效期内复用，避免频繁请求
 */
async function getAccessToken(): Promise<string> {
  const now = Date.now()
  if (accessToken && now < tokenExpireTime) {
    return accessToken
  }
  try {
    console.log('[Adapter] 正在获取 access_token...')
    const resp = await axios.post(QQ_TOKEN_URL, {
      appId: QQ_APP_ID,
      clientSecret: QQ_APP_SECRET
    })
    const data = resp.data as { access_token: string; expires_in: number }
    accessToken = data.access_token
    // 提前 5 分钟过期以留缓冲
    const expiresIn = data.expires_in || 7200
    tokenExpireTime = now + (expiresIn - 300) * 1000
    console.log(`[Adapter] access_token 获取成功，有效期 ${expiresIn}s`)
    return accessToken
  } catch (err) {
    const error = err as Error & { response?: { data: unknown } }
    console.error('[Adapter] access_token 获取失败:', error.message)
    if (error.response) {
      console.error('[Adapter] 响应详情:', JSON.stringify(error.response.data))
    }
    throw err
  }
}

/**
 * 通过 HTTP 发送消息到 QQ
 * 根据消息来源类型调用不同的发送端点
 */
export async function sendMessage(params: SendMessageParams): Promise<void> {
  const token = await getAccessToken()
  const headers = {
    'Authorization': `QQBot ${token}`,
    'Content-Type': 'application/json'
  }

  let url = ''
  const body: Record<string, unknown> = {
    content: params.content,
    msg_type: 0
  }

  if (params.sourceType === 'group' && params.groupOpenid) {
    url = `${QQ_API_BASE}/v2/groups/${params.groupOpenid}/messages`
    if (params.messageId) {
      body['msg_id'] = params.messageId
    }
    body['msg_seq'] = nextMsgSeq(params.groupOpenid)
  } else if (params.sourceType === 'c2c' && params.userOpenid) {
    url = `${QQ_API_BASE}/v2/users/${params.userOpenid}/messages`
    if (params.messageId) {
      body['msg_id'] = params.messageId
    }
    body['msg_seq'] = nextMsgSeq(params.userOpenid)
  } else if (params.sourceType === 'channel' && params.channelId) {
    url = `${QQ_API_BASE}/channels/${params.channelId}/messages`
  }

  try {
    await axios.post(url, body, { headers })
  } catch (err) {
    const error = err as Error & { response?: { data: unknown } }
    console.error('[Adapter] 消息发送失败:', error.message)
    if (error.response) {
      console.error('[Adapter] 响应详情:', JSON.stringify(error.response.data))
    }
  }
}

/** 图片消息参数 */
export interface SendImageParams {
  /** 图片 Buffer */
  imageBuffer: Buffer
  messageId?: string
  userOpenid?: string
  groupOpenid?: string
  sourceType: 'c2c' | 'group'
}

/**
 * 上传图片并发送到 QQ
 * 先将图片 base64 编码上传到 /files 获取 file_info，再用 msg_type=7 发送
 */
export async function sendImage(params: SendImageParams): Promise<void> {
  const token = await getAccessToken()

  let uploadUrl = ''
  let sendUrl = ''
  if (params.sourceType === 'group' && params.groupOpenid) {
    uploadUrl = `${QQ_API_BASE}/v2/groups/${params.groupOpenid}/files`
    sendUrl = `${QQ_API_BASE}/v2/groups/${params.groupOpenid}/messages`
  } else if (params.sourceType === 'c2c' && params.userOpenid) {
    uploadUrl = `${QQ_API_BASE}/v2/users/${params.userOpenid}/files`
    sendUrl = `${QQ_API_BASE}/v2/users/${params.userOpenid}/messages`
  } else {
    console.error('[Adapter] 图片发送失败: 缺少目标 ID')
    return
  }

  try {
    // 步骤1：base64 上传图片到 QQ 文件接口
    console.log('[Adapter] 正在上传图片（base64）...')
    const base64 = params.imageBuffer.toString('base64')
    const uploadResp = await axios.post(uploadUrl, {
      file_type: 1,
      file_data: base64
    }, {
      headers: {
        'Authorization': `QQBot ${token}`,
        'Content-Type': 'application/json'
      }
    })

    const respData = uploadResp.data as {
      file_uuid?: string
      file_info?: string
    }
    const fileInfo = respData.file_info || respData.file_uuid || ''
    if (!fileInfo) {
      console.error(
        '[Adapter] 图片上传失败: 无 file_info, body=',
        JSON.stringify(respData)
      )
      return
    }
    console.log(`[Adapter] 图片上传成功, file_info=${fileInfo}`)

    // 步骤2：发送媒体消息
    const targetKey = params.groupOpenid || params.userOpenid || 'default'
    const body: Record<string, unknown> = {
      msg_type: 7,
      media: { file_info: fileInfo },
      msg_seq: nextMsgSeq(targetKey)
    }
    if (params.messageId) {
      body['msg_id'] = params.messageId
    }

    await axios.post(sendUrl, body, {
      headers: {
        'Authorization': `QQBot ${token}`,
        'Content-Type': 'application/json'
      }
    })
    console.log('[Adapter] 图片消息发送成功')
  } catch (err) {
    const error = err as Error & { response?: { data: unknown } }
    console.error('[Adapter] 图片发送失败:', error.message)
    if (error.response) {
      console.error('[Adapter] 响应详情:', JSON.stringify(error.response.data))
    }
    // 不抛出，由调用方决定是否回退
  }
}

/**
 * 获取 WebSocket 网关地址
 * 使用 bot 专用端点 /gateway/bot
 */
async function getGatewayUrl(): Promise<string> {
  const token = await getAccessToken()
  console.log('[Adapter] 正在获取 WebSocket 网关地址...')
  const resp = await axios.get(`${QQ_API_BASE}/gateway/bot`, {
    headers: { Authorization: `QQBot ${token}` }
  })
  const data = resp.data as { url: string }
  console.log(`[Adapter] 网关地址: ${data.url}`)
  return data.url
}

/** 事件处理回调类型 */
export type EventHandler = (event: QqMessageEvent) => Promise<void>

/**
 * 启动 WebSocket 长连接
 * 处理鉴权、心跳、事件分发
 */
export function startWebSocket(onEvent: EventHandler): void {
  let ws: WebSocket | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let seq: number | null = null
  let sessionId: string | null = null

  /** 清理定时器 */
  function clearTimers(): void {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  }

  /** 启动心跳 */
  function startHeartbeat(wsInstance: WebSocket, intervalMs: number): void {
    clearTimers()
    heartbeatTimer = setInterval(() => {
      if (wsInstance.readyState === WebSocket.OPEN) {
        wsInstance.send(JSON.stringify({ op: OpCode.HEARTBEAT, d: seq }))
      }
    }, intervalMs)
  }

  /**
   * 解析收到的所有事件类型，输出日志辅助排查
   * 仅处理消息类事件，其余事件（READY 等）仅记录
   */
  function parseEvent(payload: Record<string, unknown>): QqMessageEvent | null {
    const eventType = String(payload['t'] || '')
    const data = (payload['d'] || {}) as Record<string, unknown>

    // 就绪事件：打印 bot 信息确认连接成功
    if (eventType === 'READY') {
      const user = (data['user'] || {}) as Record<string, unknown>
      console.log(
        `[Adapter] 就绪！Bot 名称: ${user['username']}, ID: ${user['id']}`
      )
      return null
    }

    // 消息事件
    if (
      eventType === 'GROUP_AT_MESSAGE_CREATE' ||
      eventType === 'C2C_MESSAGE_CREATE' ||
      eventType === 'AT_MESSAGE_CREATE' ||
      eventType === 'MESSAGE_CREATE'
    ) {
      const authorData = (data['author'] || {}) as Record<string, unknown>
      const groupOpenid = String(data['group_openid'] || '')
      const groupId = String(data['group_id'] || '')
      const channelId = String(data['channel_id'] || '')
      const guildId = String(data['guild_id'] || '')

      // 判断来源类型
      let sourceType: 'c2c' | 'group' | 'channel' = 'group'
      if (eventType === 'C2C_MESSAGE_CREATE') {
        sourceType = 'c2c'
      } else if (guildId || (channelId && !groupOpenid)) {
        sourceType = 'channel'
      }

      // 解析 msg_elements：提取附件和引用消息的附件
      const msgElems = (data['msg_elements'] || []) as Array<Record<string, unknown>>
      let attachments: QqAttachment[] = []
      let referencedAttachments: QqAttachment[] = []

      for (const elem of msgElems) {
        const elemAtt = (
          elem['attachments'] || elem['attachment'] || []
        ) as Array<Record<string, unknown>>
        if (elemAtt.length === 0) {
          continue
        }
        const parsed: QqAttachment[] = elemAtt.map((att) => ({
          url: String(att['url'] || ''),
          contentType: String(att['content_type'] || 'application/octet-stream'),
          filename: String(att['filename'] || ''),
          size: Number(att['size'] || 0)
        }))
        // 带 msg_idx 的元素是被引用的消息，其余的是本消息附件
        if (elem['msg_idx'] !== undefined) {
          referencedAttachments = [...referencedAttachments, ...parsed]
          console.log(`[Adapter] 引用消息附件: ${parsed.length} 个`)
        } else {
          attachments = [...attachments, ...parsed]
        }
      }

      return {
        id: String(data['id'] || ''),
        author: {
          id: String(authorData['id'] || ''),
          username: String(authorData['username'] || '')
        },
        content: String(data['content'] || ''),
        channelId: channelId,
        guildId: guildId || undefined,
        groupOpenid: groupOpenid || undefined,
        groupId: groupId || undefined,
        timestamp: String(data['timestamp'] || ''),
        sourceType: sourceType,
        attachments: attachments,
        referencedAttachments: referencedAttachments
      }
    }

    return null
  }

  /** 连接 WebSocket */
  async function connect(): Promise<void> {
    clearTimers()
    try {
      const gatewayUrl = await getGatewayUrl()
      const token = await getAccessToken()

      // QQ Bot WebSocket 绝大多数情况下不需要额外 header
      // 鉴权通过 IDENTIFY 帧的 token 字段完成
      console.log('[Adapter] 正在建立 WebSocket 连接...')
      ws = new WebSocket(gatewayUrl)

      ws.on('open', () => {
        console.log('[Adapter] WebSocket 已连接，等待 HELLO...')
        reconnectAttempts = 0
      })

      ws.on('message', (raw: Buffer) => {
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(raw.toString())
        } catch {
          console.warn('[Adapter] 收到非 JSON 数据')
          return
        }
        const op = payload['op'] as number

        if (op === OpCode.HELLO) {
          // 收到 HELLO 后发送 IDENTIFY
          const d = payload['d'] as Record<string, unknown>
          const heartbeatInterval = (d['heartbeat_interval'] as number) || 41250
          console.log(
            `[Adapter] 收到 HELLO，心跳间隔 ${heartbeatInterval}ms，发送 IDENTIFY...`
          )

          const identifyPayload = {
            op: OpCode.IDENTIFY,
            d: {
              token: `QQBot ${token}`,
              intents: (1 << 25), // GROUP_AND_C2C_EVENT
              shard: [0, 1],
              properties: {}
            }
          }
          ws!.send(JSON.stringify(identifyPayload))
          console.log('[Adapter] IDENTIFY 已发送')

          startHeartbeat(ws!, heartbeatInterval)
        } else if (op === OpCode.DISPATCH) {
          seq = (payload['s'] as number) ?? seq
          const d = payload['d'] as Record<string, unknown> | undefined
          if (d && d['session_id'] !== undefined) {
            sessionId = String(d['session_id'])
          }

          // 所有非 READY 事件打印类型便于排查
          const t = String(payload['t'] || '')
          if (t && t !== 'READY') {
            console.log(`[Adapter] 收到事件: ${t}`)
          }

          const event = parseEvent(payload)
          if (event) {
            // 异步处理事件，不阻塞消息接收
            onEvent(event).catch((err: Error) => {
              console.error('[Adapter] 事件处理错误:', err.message)
            })
          }
        } else if (op === OpCode.HEARTBEAT_ACK) {
          // 心跳确认，静默
        } else if (op === OpCode.RECONNECT) {
          console.log('[Adapter] 服务端要求重连')
          ws!.close()
        } else if (op === OpCode.INVALID_SESSION) {
          console.warn('[Adapter] 会话失效，将清除状态重新鉴权')
          sessionId = null
          seq = null
          ws!.close()
        } else {
          console.log(`[Adapter] 未知 op=${op}`)
        }
      })

      ws.on('close', (code: number, reason: Buffer) => {
        const reasonStr = reason.toString() || '(无)'
        console.log(
          `[Adapter] WebSocket 断开 code=${code} reason=${reasonStr}`
        )
        clearTimers()

        // 指数退避重连，最大 30 秒
        reconnectAttempts++
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000)
        console.log(`[Adapter] ${delay / 1000}s 后尝试第 ${reconnectAttempts} 次重连...`)
        reconnectTimer = setTimeout(connect, delay)
      })

      ws.on('error', (err: Error) => {
        console.error('[Adapter] WebSocket 错误:', err.message)
        // close 事件会触发重连，这里不额外处理
      })
    } catch (err) {
      const error = err as Error
      console.error('[Adapter] 连接失败:', error.message)
      // 连接级别的异常（网络/DNS）延时重试
      reconnectAttempts++
      const delay = Math.min(5000 * reconnectAttempts, 30000)
      console.log(`[Adapter] ${delay / 1000}s 后重试...`)
      reconnectTimer = setTimeout(connect, delay)
    }
  }

  connect()
}

export { getAccessToken }

/**
 * 启动时做一次连通性检查：获取 token -> 拉网关
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await getAccessToken()
    await getGatewayUrl()
    console.log('[Adapter] 连通性检查通过')
    return true
  } catch {
    return false
  }
}
