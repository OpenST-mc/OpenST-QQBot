/**
 * /upload 命令处理器
 * 生成一个带 token 的上传页面链接并发送给用户
 * token 有效期 30 分钟，单次使用后销毁
 */
import { QqMessageEvent, sendMessage } from '../bot/adapter'
import { generateUploadToken } from '../upload/server'
import { UPLOAD_PORT } from '../config'

/** 上传页面的基础 URL，从环境变量读取对外地址 */
const UPLOAD_BASE_URL =
  process.env['UPLOAD_BASE_URL'] || `http://localhost:${UPLOAD_PORT}`

export async function handleUpload(
  event: QqMessageEvent,
  _args: string
): Promise<void> {
  try {
    const uploadUrl = generateUploadToken(UPLOAD_BASE_URL)
    await sendMessage({
      content:
        '点击以下链接进入上传页面（30 分钟内有效）:\n' + uploadUrl,
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
  } catch (err) {
    const error = err as Error
    console.error('[UploadCmd] 生成上传链接失败:', error.message)
    await sendMessage({
      content: '生成上传链接失败，请稍后重试。',
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
  }
}
