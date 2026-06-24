/**
 * /learn 命令处理器
 * 用户显式传授知识，直接写入 database.md
 * 格式: /learn <标题> | <内容>
 * 例如: /learn 0t甘蔗机 | 用观察者侦测甘蔗生长，活塞收割，漏斗收集
 */
import fs from 'fs'
import { QqMessageEvent, sendMessage } from '../bot/adapter'
import { learnFromContext } from '../services/learn'

export async function handleLearn(
  event: QqMessageEvent,
  args: string
): Promise<void> {
  if (!args || args.length < 10) {
    await sendMessage({
      content:
        '用法: /learn <标题> | <内容>\n' +
        '例: /learn 0t甘蔗机 | 用观察者侦测生长，活塞收割\n' +
        '或者直接: /learn <要学习的长文本内容>',
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
    return
  }

  // 解析：如果含 | 则拆分为标题+内容
  let title = ''
  let content = args
  const pipeIdx = args.indexOf('|')
  if (pipeIdx > 0 && pipeIdx < args.length - 1) {
    title = args.slice(0, pipeIdx).trim()
    content = args.slice(pipeIdx + 1).trim()
  }

  // 构建知识条目
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
      `[Learn] 用户 ${event.author.username} 传授知识: ${title || content.slice(0, 40)}`
    )

    await sendMessage({
      content:
        '已记录！感谢贡献知识。\n' +
        (title ? `标题: ${title}` : `内容: ${content.slice(0, 50)}...`),
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
