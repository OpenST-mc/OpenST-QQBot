/**
 * /check 命令处理器
 * 仅触发静态审查，不修改代码、不重构
 * 审查结果写入根目录 check.md
 */
import path from 'path'
import { QqMessageEvent, sendMessage } from '../bot/adapter'
import { runChecker } from '../check/checker'

export async function handleCheck(
  event: QqMessageEvent,
  _args: string
): Promise<void> {
  // 先回复用户，让用户知道审查已启动
  await sendMessage({
    content: '静态代码审查已启动，完成后将生成 check.md ...',
    sourceType: event.sourceType,
    groupOpenid: event.groupOpenid,
    userOpenid: event.author.id,
    channelId: event.channelId,
    messageId: event.id
  })

  try {
    // 审查项目根目录的 src 目录
    const projectRoot = path.resolve(__dirname, '..', '..')
    const report = await runChecker(projectRoot)

    await sendMessage({
      content: report,
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
  } catch (err) {
    const error = err as Error
    await sendMessage({
      content: `审查过程出错: ${error.message}`,
      sourceType: event.sourceType,
      groupOpenid: event.groupOpenid,
      userOpenid: event.author.id,
      channelId: event.channelId,
      messageId: event.id
    })
  }
}
