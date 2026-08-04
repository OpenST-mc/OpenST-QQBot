// T1.2b 回归测试：验证 Raw 目录迁移后，既有执行期读取路径仍能找到资料
// 直接调用真实服务函数（不 mock 文件系统），必须在仓库根目录执行（见 AGENTS.md）
//
// 注意：不在此测试中 import '../../../src/commands/ask'。该模块透过
// services/context.ts 在模块作用域启动 setInterval（未 unref），会让
// node --test 进程永不退出而挂起整个测试套件；因此 loadLearnedKnowledge
// 已迁移至无此依赖链的 services/data.ts，测试直接调用该处的导出函数。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'path'
import {
  loadGlossary,
  loadMachineDatabase,
  loadLearnedKnowledge
} from '../../../src/services/data'
import { matchDictionaryTerms, getAllZhEntries } from '../../../src/services/dictionary'
import { LEARN_CSV_PATH } from '../../../src/config'

test('loadGlossary 从迁移后的 raw/TechMC Glossary.csv 读取到全部资料列', () => {
  const glossary = loadGlossary()
  assert.equal(glossary.length, 415)
})

test('loadMachineDatabase 从未迁移的 database.json 原位读取到全部机器', () => {
  const machines = loadMachineDatabase()
  assert.equal(machines.length, 81)
})

test('matchDictionaryTerms 从迁移后的 raw/dictionary/ 匹配到已知词条', () => {
  const matched = matchDictionaryTerms('Aligner 是什么')
  assert.ok(matched.some((m) => m.termsZh === '对齐器'))
})

test('getAllZhEntries 从迁移后的 raw/dictionary/zh-translations.json 读到非空词条', () => {
  const entries = getAllZhEntries()
  assert.ok(entries.length > 0)
  assert.ok(entries.some((e) => e.label === '对齐器'))
})

test('LEARN_CSV_PATH 指向迁移后的 raw/legacy/database.csv', () => {
  assert.equal(
    LEARN_CSV_PATH,
    path.join('public', 'database', 'raw', 'legacy', 'database.csv')
  )
})

test('loadLearnedKnowledge 从迁移后的 raw/legacy/database.csv 读到全部 151 笔逻辑记录', () => {
  // 与 docs/data-audit.json 的 legacy_database_csv.logicalRecordCount 基准一致：
  // 若仍按实体换行切割，带引号换行的多行记录会把总笔数拆多或拆坏，无法维持 151
  const learned = loadLearnedKnowledge()
  assert.equal(learned.length, 151)
})

test('loadLearnedKnowledge 完整读出带引号换行的多行记录，不被截断或拆散', () => {
  // 对应 public/database/raw/legacy/database.csv:133-142 的真实多行记录：
  // 简易按行切割的旧实现会在第一个内部换行处截断，只留下标题行内容
  const learned = loadLearnedKnowledge()
  const entry = learned.find((l) => l.topic === 'Appendix/专有名词解释')
  assert.ok(entry, '应能找到该笔多行记录')
  assert.ok(entry!.content.includes('## 概述'))
  assert.ok(entry!.content.includes('[#01](./01-栈.md) 栈的概念'))
  assert.ok(entry!.content.split('\n').length > 1, '内容应保留内部换行，而非被截断为单行')
})
