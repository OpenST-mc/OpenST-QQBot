// /upload 命令处理器
// bot 仅生成参数 URL，不运行上传服务器
// URL: https://vercel.app/?t=<token>&g=<enc_gh>&w=<worker_url>
import { QqMessageEvent, sendMessage } from '../bot/adapter'
import { generateToken, encryptGhToken } from '../upload/server'
import { UPLOAD_FRONTEND_URL, WORKER_URL } from '../config'

export async function handleUpload(
  event: QqMessageEvent,
  _args: string
): Promise<void> {
  try {
    if (!UPLOAD_FRONTEND_URL) {
      await sendMessage({
        content: '上传功能未配置前端地址，请联系管理员。',
        sourceType: event.sourceType,
        groupOpenid: event.groupOpenid,
        userOpenid: event.author.id,
        channelId: event.channelId,
        messageId: event.id
      })
      return
    }

    const token = generateToken()
    const encGh = encryptGhToken()
    const uploadUrl =
      `${UPLOAD_FRONTEND_URL}?t=${encodeURIComponent(token)}` +
      `&g=${encodeURIComponent(encGh)}` +
      `&w=${encodeURIComponent(WORKER_URL)}`
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
