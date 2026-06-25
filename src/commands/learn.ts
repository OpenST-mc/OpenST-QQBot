/**
 * /learn 命令处理器
 * 用户显式传授知识，支持文本 + 附件（图片OCR/文件解析）
 * 格式: /learn <标题> | <内容>
 * 写入 public/database/database.csv
 */
import fs from 'fs'
import { QqMessageEvent, sendMessage } from '../bot/adapter'
import { parseAttachments } from '../services/attachment'

const LEARN_CSV_PATH = 'public/database/database.csv'
const CSV_HEADER = 'topic,content\n'

/** CSV 转义 */
function esc(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export async function handleLearn(
  event: QqMessageEvent,
  args: string
): Promise<void> {
  // 解析附件
  let attachmentText = ''
  const attToParse =
    event.referencedAttachments.length > 0
      ? event.referencedAttachments
      : event.attachments || []
  if (attToParse.length > 0) {
    try {
      attachmentText = await parseAttachments(attToParse)
    } catch (err) {
      const error = err as Error
      console.warn('[Learn] 附件解析失败:', error.message)
    }
  }

  // 合并文本和附件内容
  let fullText = args || ''
  if (attachmentText) {
    fullText = fullText
      ? `${fullText}\n\n${attachmentText}`
      : attachmentText
  }

  if (fullText.length < 10) {
    await sendMessage({
      content:
        '用法: /learn <标题> | <内容>\n' +
        '也支持引用消息附带文件。\n' +
        '例: /learn 0t甘蔗机 | 用观察者侦测生长，活塞收割',
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
    return
  }

  // 解析标题和内容
  let title = ''
  let content = fullText
  const pipeIdx = fullText.indexOf('|')
  if (pipeIdx > 0 && pipeIdx < fullText.length - 1) {
    title = fullText.slice(0, pipeIdx).trim()
    content = fullText.slice(pipeIdx + 1).trim()
  } else {
    // 没有 | 分隔符时，取第一行作为标题
    const newlineIdx = fullText.indexOf('\n')
    if (newlineIdx > 0) {
      title = fullText.slice(0, newlineIdx).trim()
      content = fullText.slice(newlineIdx + 1).trim()
    }
  }

  if (!title) {
    title = content.slice(0, 40)
  }

  // 写入 CSV
  const row = `${esc(title)},${esc(content)}\n`
  try {
    if (!fs.existsSync(LEARN_CSV_PATH)) {
      fs.writeFileSync(LEARN_CSV_PATH, CSV_HEADER + row, 'utf-8')
    } else {
      fs.appendFileSync(LEARN_CSV_PATH, row, 'utf-8')
    }
    console.log(`[Learn] ${event.author.username}: ${title.slice(0, 40)}`)

    await sendMessage({
      content: `已记录: ${title.slice(0, 50)}`,
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
  } catch (err) {
    const error = err as Error
    console.error('[Learn] 写入失败:', error.message)
    await sendMessage({
      content: '知识录入失败，请稍后重试。',
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
  }
}
