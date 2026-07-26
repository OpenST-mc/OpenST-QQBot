/**
 * 新稿件通知
 * 构建 Markdown + 键盘消息，发送到审核群
 * 根据审核负载 @ 提示最空闲的审核人员
 */
import { sendMarkdownWithKeyboard, KeyboardRow } from '../bot/adapter'
import { GhIssue } from './gh'
import { setIssueState } from './state'
import { getIdleReviewers, getReviewerCount } from './reviewer'
import { SUBMISSIONS_AC } from './config'

/** 向审核群发送新稿件通知 */
export async function sendNotification(issue: GhIssue): Promise<void> {
  // 截取 body 的前 800 字符作为预览
  const bodyPreview = issue.body.length > 800
    ? issue.body.slice(0, 800) + '\n\n...（内容过长，已截断）'
    : issue.body

  // 构建 @ 提示文本
  const idleReviewers = getIdleReviewers()
  let atText = ''
  if (idleReviewers.length > 0) {
    const atNames = idleReviewers
      .map((openid) => `<@${openid}>`)
      .join(' ')
    atText = `\n呼唤空闲审核：${atNames}\n`
  } else if (getReviewerCount() > 0) {
    atText = '\n暂无空闲审核，请各位审核自行认领\n'
  }

  const markdownContent =
    `## 新稿件通知\n` +
    `**Issue #${issue.number}**: ${issue.title}\n` +
    `${atText}` +
    `---\n` +
    `${bodyPreview}\n` +
    `---\n` +
    `[查看原文](${issue.html_url})`

  // 构建键盘按钮
  const keyboard: KeyboardRow[] = [
    {
      buttons: [
        {
          id: `claim_${issue.number}`,
          label: '认领稿件',
          visitedLabel: '已认领',
          data: `claim:${issue.number}`
        }
      ]
    }
  ]

  const msgId = await sendMarkdownWithKeyboard({
    markdownContent,
    keyboard,
    groupOpenid: SUBMISSIONS_AC,
    sourceType: 'group'
  })

  // 记录 issue 状态
  setIssueState({
    issueNumber: issue.number,
    title: issue.title,
    body: issue.body,
    notifyMessageId: msgId || '',
    claimedBy: ''
  })

  console.log(
    `[Submissions] 已发送稿件通知 #${issue.number}` +
    (msgId ? ` | msgId=${msgId}` : '')
  )
}
