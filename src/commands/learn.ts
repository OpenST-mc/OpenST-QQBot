/**
 * /learn 命令处理器
 * 用户显式传授知识，支持文本 + 附件（图片OCR/文件解析）
 * 格式: /learn <标题> | <内容>
 */
import fs from 'fs'
import { QqMessageEvent, sendMessage } from '../bot/adapter'
import { parseAttachments } from '../services/attachment'

export async function handleLearn(
  event: QqMessageEvent,
  args: string
): Promise<void> {
  // 解析附件（优先引用消息的附件）
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
        '也支持先发 /learn 再发文件，或引用消息附带文件。\n' +
        '例: /learn 0t甘蔗机 | 用观察者侦测生长，活塞收割',
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
    return
  }

  // 解析标题
  let title = ''
  let content = fullText
  const pipeIdx = fullText.indexOf('|')
  if (pipeIdx > 0 && pipeIdx < fullText.length - 1) {
    title = fullText.slice(0, pipeIdx).trim()
    content = fullText.slice(pipeIdx + 1).trim()
  }

  const timestamp = new Date().toISOString()
  let entry: string
  if (title) {
    entry =
      `\n---\n` +
      `<!-- 学习于 ${timestamp} | 用户: ${event.author.username} -->\n` +
      `### ${title}\n` +
      `${content}\n`
  } else {
    entry =
      `\n---\n` +
      `<!-- 学习于 ${timestamp} | 用户: ${event.author.username} -->\n` +
      `${content}\n`
  }

  const learnPath = 'public/database/database.md'
  try {
    if (!fs.existsSync(learnPath)) {
      fs.writeFileSync(
        learnPath,
        '# OpenST 知识学习库\n\n> 以下内容由社区对话学习生成\n',
        'utf-8'
      )
    }
    fs.appendFileSync(learnPath, entry, 'utf-8')
    console.log(
      `[Learn] ${event.author.username}: ${title || content.slice(0, 40)}`
    )

    await sendMessage({
      content:
        '已记录！感谢贡献知识。\n' +
        (title ? `标题: ${title}` : `内容已录入`),
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
