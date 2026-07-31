// 知识系统枚举的最小回归测试

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CandidateType,
  EnumValueError,
  QualityFlag,
  REVIEW_DECISIONS,
  REVIEW_STATUS_TRANSITIONS,
  ReviewStatus,
  assertReviewStatus,
  blocksMaterialize,
  candidateTypeBlocksMaterialize,
  canTransitionReviewStatus,
  isReviewStatus
} from '../../../src/db/enums'

test('只接受已定义的审核状态', () => {
  assert.equal(isReviewStatus('pending'), true)
  assert.equal(isReviewStatus('approved'), true)
  assert.equal(isReviewStatus('Approved'), false)
  assert.equal(isReviewStatus(null), false)
  assert.throws(() => assertReviewStatus('unknown'), EnumValueError)
})

// DB 读回、AI JSON 与命令参数会绕过编译期类型，非法值必须报出可读错误而非 TypeError
test('转移检查对非法状态值抛出枚举错误', () => {
  assert.throws(
    () => canTransitionReviewStatus('archived' as ReviewStatus, 'approved', 'reviewer'),
    EnumValueError
  )
  assert.throws(
    () => canTransitionReviewStatus('pending', 'Approved' as ReviewStatus, 'reviewer'),
    EnumValueError
  )
  const unknown = 'archived' as ReviewStatus
  assert.throws(
    () => canTransitionReviewStatus(unknown, unknown, 'reviewer'),
    EnumValueError
  )
})

test('只有审核者可以将待审内容核准', () => {
  assert.equal(canTransitionReviewStatus('pending', 'approved', 'reviewer'), true)
  assert.equal(canTransitionReviewStatus('pending', 'approved', 'system'), false)
})

test('后台作业不得单方面裁决争议或废弃已核准内容', () => {
  assert.equal(canTransitionReviewStatus('disputed', 'rejected', 'system'), false)
  assert.equal(canTransitionReviewStatus('disputed', 'deprecated', 'system'), false)
  assert.equal(canTransitionReviewStatus('approved', 'deprecated', 'system'), false)
  assert.equal(canTransitionReviewStatus('disputed', 'rejected', 'reviewer'), true)
})

// 上一个案例之所以成立，前提是每个转移目标都属于 REVIEW_DECISIONS，
// 因而全部落在 REVIEWER_ONLY_TO 的保护内；新增目标状态时这里会先失败
test('转移表不得出现审核决定以外的目标状态', () => {
  const targets = new Set(Object.values(REVIEW_STATUS_TRANSITIONS).flat())
  for (const target of targets) {
    assert.ok(
      (REVIEW_DECISIONS as readonly string[]).includes(target),
      `${target} 不是审核决定，system 将可绕过审核推动此转移`
    )
  }
})

test('被拒和废弃内容不能直接恢复', () => {
  assert.equal(canTransitionReviewStatus('rejected', 'approved', 'reviewer'), false)
  assert.equal(canTransitionReviewStatus('deprecated', 'pending', 'reviewer'), false)
})

test('不可用或待确认质量旗标不会 materialize', () => {
  assert.equal(blocksMaterialize('empty'), true)
  assert.equal(blocksMaterialize('conflicting_fact'), true)
  assert.equal(blocksMaterialize('broken_link'), false)
})

// 依计划书 materialize 规则：navigation 阻挡带此标记的候选本身，
// 但 blocksMaterialize 只按单一候选的旗标判断，不查询同资产其他候选，
// 天然满足「不连坐」——这里只需确认候选层级会被挡
test('导航候选本身被阻挡 materialize', () => {
  assert.equal(blocksMaterialize('navigation'), true)
})

test('discard 与 needs_review 候选不会 materialize', () => {
  assert.equal(candidateTypeBlocksMaterialize('discard'), true)
  assert.equal(candidateTypeBlocksMaterialize('needs_review'), true)
  assert.equal(candidateTypeBlocksMaterialize('term'), false)
})

// AI JSON 的 qualityFlags/candidateType 是任意字符串，未知值必须报错而非当作安全值
// 静默放行会让格式漂移或拼写错误的内容绕过 materialize 唯一的审核关卡
test('未知质量旗标或候选类型不会被当成可 materialize', () => {
  assert.throws(
    () => blocksMaterialize('made_up_flag' as QualityFlag),
    EnumValueError
  )
  assert.throws(
    () => candidateTypeBlocksMaterialize('made_up_type' as CandidateType),
    EnumValueError
  )
})
