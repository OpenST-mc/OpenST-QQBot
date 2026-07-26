// 投稿审核相关命令
// /list - 查看已认领的稿件，附带通过/拒稿按钮
import { QqMessageEvent, sendMarkdownWithKeyboard, sendMessage } from '../bot/adapter'
import { getClaimedByUser } from './state'
import { isReviewer } from './reviewer'

// /list 命令：列出当前用户已认领的稿件
export async function handleList(event: QqMessageEvent): Promise<void> {
  const userOpenid = event.author.id
  const groupOpenid = event.groupOpenid || ''

  if (!isReviewer(userOpenid)) {
    await sendMessage({
      content: '你没有审核权限。',
      sourceType: event.sourceType,
      groupOpenid: groupOpenid,
      userOpenid: userOpenid,
      channelId: event.channelId,
      messageId: event.id
    })
    return
  }

  const claimed = getClaimedByUser(userOpenid)

  if (claimed.length === 0) {
    await sendMessage({
      content: '你当前没有认领的稿件。',
      sourceType: event.sourceType,
      groupOpenid: groupOpenid,
      userOpenid: userOpenid,
      channelId: event.channelId,
      messageId: event.id
    })
    return
  }

  // 构建消息内容和键盘
  let markdownContent = `**你认领的稿件** (${claimed.length} 个):\n`
  const keyboard: Array<{
    buttons: Array<{
      id: string
      label: string
      visitedLabel: string
      data: string
    }>
  }> = []

  for (const issue of claimed) {
    markdownContent +=
      `- #${issue.issueNumber}: ${issue.title}\n`

    keyboard.push({
      buttons: [
        {
          id: `approve_${issue.issueNumber}`,
          label: `通过`,
          visitedLabel: '已处理',
          data: `approve:${issue.issueNumber}`
        },
        {
          id: `reject_${issue.issueNumber}`,
          label: `拒稿`,
          visitedLabel: '已处理',
          data: `reject:${issue.issueNumber}`
        }
      ]
    })
  }

  await sendMarkdownWithKeyboard({
    markdownContent,
    keyboard,
    sourceType: event.sourceType === 'channel' ? 'group' : event.sourceType,
    groupOpenid: groupOpenid,
    userOpenid: userOpenid,
    messageId: event.id,
    allowAllClick: true
  })
}
