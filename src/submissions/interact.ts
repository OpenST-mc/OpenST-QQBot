/**
 * 按钮交互处理器
 * 接收 QQ 的 INTERACTION_CREATE 事件，解析回调数据并分发到对应操作
 */
import { QqInteractionEvent } from '../bot/adapter'
import { claimIssue, approveIssue, rejectIssue, ActionContext } from './actions'

/** 处理按钮点击交互 */
export async function handleInteraction(
  interaction: QqInteractionEvent
): Promise<void> {
  const data = interaction.data || ''
  console.log(
    `[Submissions] 收到交互: type=${interaction.type}` +
    ` | user=${interaction.userId}` +
    ` | data="${data}"`
  )

  // 解析回调数据格式：action:issueNumber
  const colonIndex = data.indexOf(':')
  if (colonIndex === -1) {
    console.warn(`[Submissions] 无效的交互数据: "${data}"`)
    return
  }

  const action = data.slice(0, colonIndex)
  const issueNumber = parseInt(data.slice(colonIndex + 1), 10)

  if (isNaN(issueNumber)) {
    console.warn(`[Submissions] 无效的 issue 编号: "${data}"`)
    return
  }

  const ctx: ActionContext = {
    userOpenid: interaction.userId,
    groupOpenid: interaction.groupOpenid || ''
  }

  switch (action) {
    case 'claim':
      await claimIssue(issueNumber, ctx)
      break
    case 'approve':
      await approveIssue(issueNumber, ctx)
      break
    case 'reject':
      await rejectIssue(issueNumber, ctx)
      break
    default:
      console.warn(`[Submissions] 未知操作: "${action}"`)
  }
}
