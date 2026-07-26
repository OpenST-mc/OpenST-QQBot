// 投稿审核系统持久化状态
// 使用 JSON 文件存储已通知 issue 编号和认领关系
// 每次轮询时自动清理已关闭 issue 的遗留记录
import * as fs from 'fs'
import * as path from 'path'

// 单条 issue 的审核状态
export interface IssueState {
  issueNumber: number
  title: string
  body: string
  notifyMessageId: string
  claimedBy: string
  // 是否正在处理通过/拒稿流程，防止按钮/文本回退重复触发并发操作
  processing?: boolean
}

// 持久化数据结构
interface PersistedState {
  seen: number[]
  issues: Record<number, IssueState>
}

const STATE_FILE = path.resolve('public/database/submissions.json')

let seenSet = new Set<number>()
let issueMap = new Map<number, IssueState>()

// 从 JSON 文件加载状态
export function loadState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8')
      const data = JSON.parse(raw) as PersistedState

      seenSet = new Set(data.seen || [])
      issueMap = new Map()
      let clearedProcessingLock = false

      for (const [key, value] of Object.entries(data.issues || {})) {
        const issue = value as IssueState
        if (issue.processing) {
          // 处理锁仅用于当前进程防止重复操作，重启后必须允许恢复处理
          issue.processing = false
          clearedProcessingLock = true
        }
        issueMap.set(Number(key), issue)
      }

      if (clearedProcessingLock) {
        saveState()
      }

      console.log(
        `[Submissions] 状态已加载: ${seenSet.size} 条已通知记录,` +
        ` ${issueMap.size} 个活跃稿件`
      )
    } else {
      console.log('[Submissions] 无历史状态文件，从零开始')
    }
  } catch (err) {
    const error = err as Error
    console.error('[Submissions] 状态文件加载失败:', error.message)
    seenSet = new Set()
    issueMap = new Map()
  }
}

// 保存状态到 JSON 文件（原子写入：先写临时文件再 rename）
function saveState(): void {
  try {
    const dir = path.dirname(STATE_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const issues: Record<number, IssueState> = {}
    for (const [key, value] of issueMap) {
      issues[key] = value
    }

    const data: PersistedState = {
      seen: Array.from(seenSet),
      issues
    }

    const tmpPath = STATE_FILE + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpPath, STATE_FILE)
  } catch (err) {
    const error = err as Error
    console.error('[Submissions] 状态文件保存失败:', error.message)
  }
}

// 标记 issue 已通知
export function markSeen(issueNumber: number): void {
  seenSet.add(issueNumber)
  saveState()
}

// 检查 issue 是否已通知过
export function isSeen(issueNumber: number): boolean {
  return seenSet.has(issueNumber)
}

// 保存 issue 状态
export function setIssueState(state: IssueState): void {
  issueMap.set(state.issueNumber, state)
  saveState()
}

// 获取 issue 状态
export function getIssueState(issueNumber: number): IssueState | undefined {
  return issueMap.get(issueNumber)
}

// 删除 issue 状态（审批完成后）
export function deleteIssueState(issueNumber: number): void {
  issueMap.delete(issueNumber)
  saveState()
}

// 清理已关闭 issue 的遗留记录
// 传入选定的当前 open issue 编号集合，不在其中的记录会被从 JSON 中清除
export function cleanClosedIssues(openIssueNumbers: Set<number>): void {
  // 清理 seenSet 中已关闭的 issue
  for (const num of seenSet) {
    if (!openIssueNumbers.has(num)) {
      seenSet.delete(num)
    }
  }

  // 清理 issueMap 中已关闭的 issue（理论上不应该出现，除非手动关闭）
  for (const num of issueMap.keys()) {
    if (!openIssueNumbers.has(num)) {
      issueMap.delete(num)
    }
  }

  saveState()
}

// 获取某用户认领的所有 issue
export function getClaimedByUser(userOpenid: string): IssueState[] {
  const result: IssueState[] = []
  for (const state of issueMap.values()) {
    if (state.claimedBy === userOpenid) {
      result.push(state)
    }
  }
  return result
}

// 获取某用户当前认领数
export function getClaimedCount(userOpenid: string): number {
  let count = 0
  for (const state of issueMap.values()) {
    if (state.claimedBy === userOpenid) {
      count++
    }
  }
  return count
}
