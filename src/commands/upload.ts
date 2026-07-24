/**
 * /upload 命令处理器
 * 生成带 token 的上传链接，指向 Vercel 部署的独立前端页面
 * token 有效期 30 分钟，单次使用后销毁
 */
import { QqMessageEvent, sendMessage } from '../bot/adapter'
import { generateToken } from '../upload/server'
import { UPLOAD_FRONTEND_URL, UPLOAD_PORT } from '../config'

/** 上传 API 对外地址（前端需 POST 至此） */
const UPLOAD_API_URL =
  process.env['UPLOAD_BASE_URL'] || `http://localhost:${UPLOAD_PORT}`

export async function handleUpload(
  event: QqMessageEvent,
  _args: string
): Promise<void> {
  try {
    const token = generateToken()
    const uploadUrl =
      `${UPLOAD_FRONTEND_URL}?token=${token}` +
      `&api=${encodeURIComponent(UPLOAD_API_URL)}`
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
