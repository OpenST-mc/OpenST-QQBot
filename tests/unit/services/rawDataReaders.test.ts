// T1.2b 回归测试：验证 Raw 目录迁移后，既有执行期读取路径仍能找到资料
// 直接调用真实服务函数（不 mock 文件系统），必须在仓库根目录执行（见 AGENTS.md）
//
// 注意：不在此测试中 import '../../../src/commands/ask'。该模块透过
// services/context.ts 在模块作用域启动 setInterval（未 unref），会让
// node --test 进程永不退出而挂起整个测试套件；因此改以 LEARN_CSV_PATH +
// csv-parse 直接验证 /ask、/learn 共用的已学知识 CSV 在迁移后仍可读取。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'fs'
import path from 'path'
import { parse } from 'csv-parse/sync'
import { loadGlossary, loadMachineDatabase } from '../../../src/services/data'
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

test('LEARN_CSV_PATH 指向迁移后的 raw/legacy/database.csv 且可读取到已学知识', () => {
  assert.equal(
    LEARN_CSV_PATH,
    path.join('public', 'database', 'raw', 'legacy', 'database.csv')
  )
  const raw = fs.readFileSync(LEARN_CSV_PATH, 'utf-8')
  const records = parse(raw, { columns: true, skip_empty_lines: true }) as Array<{
    topic: string
    content: string
  }>
  assert.ok(records.some((r) => r.topic === '整流'))
})
