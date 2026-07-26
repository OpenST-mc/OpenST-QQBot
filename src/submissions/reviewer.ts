/**
 * 审核人员管理
 * 负载均衡算法：按当前认领数升序分组，同负载组内随机选取
 */
import { SUBMISSIONS_REVIEWERS, SUBMISSIONS_AT_COUNT } from './config'
import { getClaimedCount } from './state'

/** 获取当前最空闲的审核人员列表（最少负载优先，同负载随机） */
export function getIdleReviewers(): string[] {
  const reviewers = Array.from(SUBMISSIONS_REVIEWERS)
  if (reviewers.length === 0) return []

  const withLoad = reviewers.map((openid) => ({
    openid,
    load: getClaimedCount(openid)
  }))

  // 按负载分组
  const groups = new Map<number, string[]>()
  for (const item of withLoad) {
    const list = groups.get(item.load)
    if (list) {
      list.push(item.openid)
    } else {
      groups.set(item.load, [item.openid])
    }
  }

  // 对各组内随机打乱
  for (const [, list] of groups) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = list[i]
      list[i] = list[j]
      list[j] = tmp
    }
  }

  // 按负载升序排列组
  const sortedGroups = Array.from(groups.entries()).sort(
    (a, b) => a[0] - b[0]
  )

  // 从低负载组依次取人，直到满 N 个
  const count = Math.min(SUBMISSIONS_AT_COUNT, reviewers.length)
  const result: string[] = []
  for (const [, list] of sortedGroups) {
    for (const openid of list) {
      result.push(openid)
      if (result.length >= count) return result
    }
  }

  return result
}

/** 检查用户是否为审核人员 */
export function isReviewer(userOpenid: string): boolean {
  if (SUBMISSIONS_REVIEWERS.size === 0) return false
  return SUBMISSIONS_REVIEWERS.has(userOpenid)
}

/** 获取审核人员数量 */
export function getReviewerCount(): number {
  return SUBMISSIONS_REVIEWERS.size
}
