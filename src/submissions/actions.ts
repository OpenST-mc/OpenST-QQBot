// 审核操作：认领、通过、拒稿
// 包含权限校验和 GitHub API 调用
import { sendMessage, sendMarkdown } from '../bot/adapter'
import {
  closeIssueAsCompleted,
  closeIssueAsNotPlanned,
  uploadFileToWebsite
} from './gh'
import { extractDownloadUrl, downloadAndExtract } from './download'
import {
  getIssueState,
  setIssueState,
  deleteIssueState,
  getClaimedByUser
} from './state'
import { isReviewer } from './reviewer'
import { SUBMISSIONS_AC } from './config'

// 交互响应上下文
export interface ActionContext {
  userOpenid: string
  groupOpenid: string
}

// 认领稿件
// 仅审核人员可认领
export async function claimIssue(
  issueNumber: number,
  ctx: ActionContext
): Promise<void> {
  if (!isReviewer(ctx.userOpenid)) {
    await sendMessage({
      content:
        `你没有审核权限，无法认领稿件。` +
        `\n你的 openid: ${ctx.userOpenid}` +
        `\n请确认该 openid 已配置到 SUBMISSIONS_REVIEWERS`,
      sourceType: 'group',
      groupOpenid: ctx.groupOpenid
    })
    return
  }

  const state = getIssueState(issueNumber)
  if (!state) {
    await sendMessage({
      content: `稿件 #${issueNumber} 不存在或已过期。`,
      sourceType: 'group',
      groupOpenid: ctx.groupOpenid
    })
    return
  }

  if (state.claimedBy) {
    if (state.claimedBy === ctx.userOpenid) {
      await sendMessage({
        content: `你已经认领了稿件 #${issueNumber}: ${state.title}`,
        sourceType: 'group',
        groupOpenid: ctx.groupOpenid
      })
    } else {
      await sendMessage({
        content: `稿件 #${issueNumber} 已被 <@${state.claimedBy}> 认领。`,
        sourceType: 'group',
        groupOpenid: ctx.groupOpenid
      })
    }
    return
  }

  state.claimedBy = ctx.userOpenid
  setIssueState(state)

  const claimed = getClaimedByUser(ctx.userOpenid)
  await sendMarkdown({
    markdownContent:
      `**稿件已认领**\n` +
      `审核人: <@${ctx.userOpenid}>\n` +
      `Issue: #${issueNumber} ${state.title}\n` +
      `当前待审核: ${claimed.length} 个\n` +
      `使用 \`/list\` 查看你的认领列表`,
    sourceType: 'group',
    groupOpenid: ctx.groupOpenid
  })

  console.log(
    `[Submissions] 稿件 #${issueNumber} 被 ${ctx.userOpenid} 认领`
  )
}

// 通过稿件
// 下载投稿包 -> 解压 -> 上传文件到 website 仓库 -> 关闭 issue
export async function approveIssue(
  issueNumber: number,
  ctx: ActionContext
): Promise<void> {
  const state = getIssueState(issueNumber)
  if (!state) {
    await sendMessage({
      content: `稿件 #${issueNumber} 不存在或已过期。`,
      sourceType: 'group',
      groupOpenid: ctx.groupOpenid
    })
    return
  }

  if (state.claimedBy !== ctx.userOpenid) {
    await sendMessage({
      content:
        `稿件 #${issueNumber} 由 <@${state.claimedBy || '未知'}> 认领，` +
        `只有认领人可以操作。`,
      sourceType: 'group',
      groupOpenid: ctx.groupOpenid
    })
    return
  }

  // 防止按钮连点或文本回退重试触发并发处理
  if (state.processing) {
    await sendMessage({
      content: `稿件 #${issueNumber} 正在处理中，请稍候。`,
      sourceType: 'group',
      groupOpenid: ctx.groupOpenid
    })
    return
  }

  state.processing = true
  setIssueState(state)

  try {
    // 提取下载链接
    const downloadUrl = extractDownloadUrl(state.body)
    if (!downloadUrl) {
      state.processing = false
      setIssueState(state)
      await sendMessage({
        content: `稿件 #${issueNumber} 中未找到下载链接，请检查 issue 内容。`,
        sourceType: 'group',
        groupOpenid: ctx.groupOpenid
      })
      return
    }

    await sendMessage({
      content: `正在处理稿件 #${issueNumber}：下载并上传文件...`,
      sourceType: 'group',
      groupOpenid: ctx.groupOpenid
    })

    console.log(
      `[Submissions] 开始处理稿件 #${issueNumber}，下载链接: ${downloadUrl}`
    )

    // 下载并解压
    const files = await downloadAndExtract(downloadUrl)
    const fileNames = Object.keys(files)
    console.log(
      `[Submissions] 解压完成，共 ${fileNames.length} 个文件:`,
      fileNames.join(', ')
    )

    // 逐个上传到 website 仓库
    let uploadedCount = 0
    for (const [filePath, data] of Object.entries(files)) {
      try {
        const contentBase64 = data.toString('base64')
        await uploadFileToWebsite(filePath, contentBase64)
        uploadedCount++
      } catch (err) {
        const error = err as Error
        console.error(
          `[Submissions] 上传文件失败 ${filePath}:`,
          error.message
        )
      }
    }

    // 至少有一个文件上传成功才关闭 issue，全部失败则报错
    if (uploadedCount === 0) {
      state.processing = false
      setIssueState(state)
      await sendMessage({
        content:
          `稿件 #${issueNumber} 处理失败：所有文件上传均未成功，` +
          `请检查 GitHub token 权限或文件是否已存在。Issue 未关闭。`,
        sourceType: 'group',
        groupOpenid: ctx.groupOpenid
      })
      return
    }

    // 关闭 issue 为 completed
    await closeIssueAsCompleted(issueNumber)

    // 清理本地状态
    deleteIssueState(issueNumber)

    await sendMarkdown({
      markdownContent:
        `**稿件已通过** #${issueNumber}: ${state.title}\n` +
        `审核人: <@${ctx.userOpenid}>\n` +
        `已上传 ${uploadedCount}/${fileNames.length} 个文件到存档`,
      sourceType: 'group',
      groupOpenid: ctx.groupOpenid
    })

    console.log(
      `[Submissions] 稿件 #${issueNumber} 审核通过，` +
      `上传 ${uploadedCount} 个文件`
    )
  } catch (err) {
    state.processing = false
    setIssueState(state)

    const error = err as Error
    console.error(
      `[Submissions] 稿件 #${issueNumber} 处理失败:`,
      error.message
    )
    await sendMessage({
      content:
        `稿件 #${issueNumber} 处理失败: ${error.message}`,
      sourceType: 'group',
      groupOpenid: ctx.groupOpenid
    })
  }
}

// 拒稿
// 关闭 issue 为 not_planned
export async function rejectIssue(
  issueNumber: number,
  ctx: ActionContext
): Promise<void> {
  const state = getIssueState(issueNumber)
  if (!state) {
    await sendMessage({
      content: `稿件 #${issueNumber} 不存在或已过期。`,
      sourceType: 'group',
      groupOpenid: ctx.groupOpenid
    })
    return
  }

  if (state.claimedBy !== ctx.userOpenid) {
    await sendMessage({
      content:
        `稿件 #${issueNumber} 由 <@${state.claimedBy || '未知'}> 认领，` +
        `只有认领人可以操作。`,
      sourceType: 'group',
      groupOpenid: ctx.groupOpenid
    })
    return
  }

  // 防止按钮连点或文本回退重试触发并发处理
  if (state.processing) {
    await sendMessage({
      content: `稿件 #${issueNumber} 正在处理中，请稍候。`,
      sourceType: 'group',
      groupOpenid: ctx.groupOpenid
    })
    return
  }

  state.processing = true
  setIssueState(state)

  try {
    await closeIssueAsNotPlanned(issueNumber)

    // 清理本地状态
    deleteIssueState(issueNumber)

    await sendMarkdown({
      markdownContent:
        `**稿件已拒稿** #${issueNumber}: ${state.title}\n` +
        `审核人: <@${ctx.userOpenid}>`,
      sourceType: 'group',
      groupOpenid: ctx.groupOpenid
    })

    console.log(
      `[Submissions] 稿件 #${issueNumber} 被 ${ctx.userOpenid} 拒稿`
    )
  } catch (err) {
    state.processing = false
    setIssueState(state)

    const error = err as Error
    console.error(
      `[Submissions] 稿件 #${issueNumber} 拒稿失败:`,
      error.message
    )
    await sendMessage({
      content: `稿件 #${issueNumber} 拒稿失败: ${error.message}`,
      sourceType: 'group',
      groupOpenid: ctx.groupOpenid
    })
  }
}
