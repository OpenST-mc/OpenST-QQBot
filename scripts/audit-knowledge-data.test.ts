// scripts/audit-knowledge-data.ts 的整合測試
// 在暫存目錄建立最小合法的 7 個來源檔案，驗證 buildReport()/runAudit() 端對端行為
// 完全不讀寫 public/database/ 下的正式資料
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildReport, runAudit } from './audit-knowledge-data'

let rootDir: string

// 建立最小合法的 public/database/ 樹狀結構，數字皆為容易驗證的小樣本
function seedFixtureRepo(dir: string): void {
  const dbDir = join(dir, 'public', 'database')
  mkdirSync(dbDir, { recursive: true })

  writeFileSync(
    join(dbDir, 'database.json'),
    JSON.stringify([
      { id: '1', name: 'A', author: 'x', tags: ['t1', 't2'], description: 'd', sub_id: 'sub-1' },
      { id: '2', name: 'B', author: 'y', tags: ['t1'], description: '', sub_id: 'sub-2' }
    ])
  )

  writeFileSync(
    join(dbDir, 'database.csv'),
    'topic,content\n' +
      '整流,單行內容\n' +
      '"多行","第一行\n第二行"\n'
  )

  writeFileSync(join(dbDir, 'database.md'), '# 標題\n內容\n## 子標題\n')

  writeFileSync(
    join(dbDir, 'Dictionary.txt'),
    'Aligner-矫正器\n沒有分隔符的行\n'
  )

  const glossaryContent =
    '﻿' +
    'Category,Short Form,Full Form (English)\n' +
    'A,BUD,Block Update Detector\n' +
    'B,,Something\n'
  writeFileSync(join(dbDir, 'TechMC Glossary.csv'), glossaryContent)

  const entriesDir = join(dbDir, 'dictionary', 'entries')
  mkdirSync(entriesDir, { recursive: true })
  writeFileSync(
    join(entriesDir, '1.json'),
    JSON.stringify({ id: '1', terms: ['BUD'], definition: '定義', status: 'APPROVED' })
  )
  writeFileSync(
    join(entriesDir, '2.json'),
    JSON.stringify({ id: '2', terms: [], definition: '', status: 'PENDING' })
  )
  writeFileSync(
    join(dbDir, 'dictionary', 'zh-translations.json'),
    JSON.stringify({ entries: [{ id: '1', termsZh: '方块更新检测器', definitionZh: '定義' }] })
  )

  const gtmcDir = join(dbDir, 'gtmc-database')
  mkdirSync(gtmcDir, { recursive: true })
  writeFileSync(
    join(gtmcDir, 'normal.md'),
    `# 正常文件\n${'內容'.repeat(30)}\n![圖片](img/missing.png)`
  )
  writeFileSync(join(gtmcDir, '404.md'), '# 找不到頁面\n404')
  writeFileSync(join(gtmcDir, 'short.md'), '# 未完成\n待補')
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'audit-fixture-'))
  seedFixtureRepo(rootDir)
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

describe('buildReport', () => {
  it('依 fixture 資料計算出正確的各來源統計', () => {
    const report = buildReport(rootDir)

    assert.equal(report.sources.openst_machine_submission.machineCount, 2)
    assert.equal(report.sources.openst_machine_submission.totalTagCount, 3)
    assert.equal(report.sources.openst_machine_submission.emptyDescriptionCount, 1)

    assert.equal(report.sources.legacy_database_csv.logicalRecordCount, 2)
    assert.equal(report.sources.legacy_database_csv.multilineRecordCount, 1)

    assert.equal(report.sources.legacy_database_markdown.lineCount, 3)
    assert.equal(report.sources.legacy_database_markdown.headingCount, 2)

    assert.equal(report.sources.storage_tech_dictionary.entryFileCount, 2)
    assert.equal(report.sources.storage_tech_dictionary.recordCount, 2)
    assert.equal(report.sources.storage_tech_dictionary.emptyDefinitionCount, 1)
    assert.equal(report.sources.storage_tech_dictionary.missingZhTranslationCount, 1)
    assert.equal(report.sources.storage_tech_dictionary.dictionaryTxt.malformedLineCount, 1)

    assert.equal(report.sources.techmc_glossary.encoding, 'utf-8-bom')
    assert.equal(report.sources.techmc_glossary.rowCount, 2)
    assert.equal(report.sources.techmc_glossary.emptyShortFormCount, 1)

    assert.equal(report.sources.gtmc.fileCount, 3)
    assert.deepEqual(report.sources.gtmc.fileTypeBreakdown, { normal: 1, stub: 1, not_found: 1 })
    assert.deepEqual(report.sources.gtmc.encodingBreakdown, { 'utf-8': 3, 'utf-8-bom': 0 })
    assert.equal(report.sources.gtmc.duplicateWithLegacyCsvCount, 0)
    assert.equal(report.sources.gtmc.brokenLinkCount, 1)
  })

  it('GTMC 內容與 database.csv 逐字重複時計入 duplicateWithLegacyCsvCount', () => {
    const dbDir = join(rootDir, 'public', 'database')
    writeFileSync(
      join(dbDir, 'database.csv'),
      'topic,content\n' + '整流,一段與 GTMC 逐字重複的內容\n'
    )
    writeFileSync(
      join(dbDir, 'gtmc-database', 'dup-of-csv.md'),
      '一段與 GTMC 逐字重複的內容'
    )

    const report = buildReport(rootDir)
    assert.equal(report.sources.gtmc.duplicateWithLegacyCsvCount, 1)
  })
})

describe('runAudit', () => {
  interface CapturedIo {
    log: string[]
    error: string[]
    io: { log: (m: string) => void; error: (m: string) => void }
  }

  function makeIo(): CapturedIo {
    const log: string[] = []
    const error: string[] = []
    return { log, error, io: { log: (m) => log.push(m), error: (m) => error.push(m) } }
  }

  it('找不到基準快照時回傳非零並輸出錯誤訊息', () => {
    const { error, io } = makeIo()
    const exitCode = runAudit(rootDir, [], io)
    assert.equal(exitCode, 1)
    assert.match(error[0], /找不到基準快照/)
  })

  it('--write 建立基準快照並回傳 0', () => {
    const { log, io } = makeIo()
    const exitCode = runAudit(rootDir, ['--write'], io)
    assert.equal(exitCode, 0)
    assert.match(log[0], /已寫入基準快照/)

    const written = JSON.parse(
      readFileSync(join(rootDir, 'docs', 'data-audit.json'), 'utf-8')
    )
    assert.equal(written.sources.openst_machine_submission.machineCount, 2)
  })

  it('基準快照與現況相符時輸出無差異並回傳 0', () => {
    runAudit(rootDir, ['--write'], { log: () => {}, error: () => {} })
    const { log, io } = makeIo()
    const exitCode = runAudit(rootDir, [], io)
    assert.equal(exitCode, 0)
    assert.equal(log[0], '資料盤點無差異')
  })

  it('來源資料變更後偵測到差異並回傳非零', () => {
    runAudit(rootDir, ['--write'], { log: () => {}, error: () => {} })

    const dbJsonPath = join(rootDir, 'public', 'database', 'database.json')
    const machines = JSON.parse(readFileSync(dbJsonPath, 'utf-8'))
    machines.push({ id: '3', name: 'C', author: 'z', tags: [], description: 'd', sub_id: 'sub-3' })
    writeFileSync(dbJsonPath, JSON.stringify(machines))

    const { log, io } = makeIo()
    const exitCode = runAudit(rootDir, [], io)
    assert.equal(exitCode, 1)
    assert.ok(log.some((line) => line.includes('machineCount')))
  })
})
