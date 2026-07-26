// GitHub Issues 轮询监控
// 定时拉取 Submissions 仓库 open issues，发现新 issue 时触发通知
// 每次轮询结束后清理 JSON 中已关闭 issue 的遗留记录
import { fetchOpenIssues, GhIssue } from './gh'
import { isSeen, markSeen, loadState, cleanClosedIssues } from './state'
import { sendNotification } from './notify'
import { SUBMISSIONS_POLL_INTERVAL_S, SUBMISSIONS_AC } from './config'

let pollTimer: ReturnType<typeof setInterval> | null = null

// 防重入锁：防止上次轮询未完成时再次触发
let polling = false

// 启动轮询
export function startPolling(): void {
  if (!SUBMISSIONS_AC) {
    console.log('[Submissions] SUBMISSIONS_AC 未配置，跳过轮询')
    return
  }

  // 加载持久化状态
  loadState()

  console.log(
    `[Submissions] 启动轮询，间隔 ${SUBMISSIONS_POLL_INTERVAL_S}s` +
    ` | 通知群: ${SUBMISSIONS_AC}`
  )

  // 立即执行一次
  pollOnce()

  pollTimer = setInterval(() => {
    if (!polling) {
      pollOnce()
    }
  }, SUBMISSIONS_POLL_INTERVAL_S * 1000)
}

// 停止轮询
export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// 执行一次轮询
async function pollOnce(): Promise<void> {
  if (polling) return
  polling = true
  try {
    const issues = await fetchOpenIssues()
    const openNumbers = new Set(issues.map((i) => i.number))

    console.log(
      `[Submissions] 轮询完成，获取到 ${issues.length} 个 open issues`
    )

    let newCount = 0
    for (const issue of issues) {
      if (isSeen(issue.number)) continue

      // 跳过 Wiki 类 issue，不发送稿件通知
      if (issue.title.startsWith('[Wiki 新投稿]') ||
          issue.title.startsWith('[Wiki 修正]')) {
        console.log(
          `[Submissions] 跳过 Wiki 类 issue #${issue.number}: ${issue.title}`
        )
        markSeen(issue.number)
        continue
      }

      // 先发送通知，成功后再标记已见，避免通知失败丢失 issue
      try {
        await sendNotification(issue)
        markSeen(issue.number)
        newCount++
      } catch (err) {
        const error = err as Error
        console.error(
          `[Submissions] 通知发送失败 #${issue.number}: ${error.message}` +
          ` | 未标记已见，下次轮询重试`
        )
      }
    }

    if (newCount > 0) {
      console.log(`[Submissions] 发现 ${newCount} 个新稿件`)
    }

    // 清理 JSON 中已关闭 issue 的滞留记录
    cleanClosedIssues(openNumbers)
  } catch (err) {
    const error = err as Error
    console.error('[Submissions] 轮询失败:', error.message)
  } finally {
    polling = false
  }
}
