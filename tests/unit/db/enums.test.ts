// 知识系统枚举的最小回归测试

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EnumValueError,
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

test('只有审核者可以将待审内容核准', () => {
  assert.equal(canTransitionReviewStatus('pending', 'approved', 'reviewer'), true)
  assert.equal(canTransitionReviewStatus('pending', 'approved', 'system'), false)
})

test('被拒和废弃内容不能直接恢复', () => {
  assert.equal(canTransitionReviewStatus('rejected', 'approved', 'reviewer'), false)
  assert.equal(canTransitionReviewStatus('deprecated', 'pending', 'reviewer'), false)
})

test('不可用或待确认质量旗标不会 materialize', () => {
  assert.equal(blocksMaterialize('empty'), true)
  assert.equal(blocksMaterialize('conflicting_fact'), true)
  assert.equal(blocksMaterialize('invalid_ai_output'), true)
  assert.equal(blocksMaterialize('broken_link'), false)
})

test('导航旗标只排除对应区段，不阻挡同一资产的有效候选', () => {
  assert.equal(blocksMaterialize('navigation'), false)
})

test('discard 与 needs_review 候选不会 materialize', () => {
  assert.equal(candidateTypeBlocksMaterialize('discard'), true)
  assert.equal(candidateTypeBlocksMaterialize('needs_review'), true)
  assert.equal(candidateTypeBlocksMaterialize('term'), false)
})
