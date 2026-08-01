// scripts/audit-knowledge-data.ts 的整合測試
// 在暫存目錄建立最小合法的 7 個來源檔案，驗證 buildReport()/runAudit() 端對端行為
// 完全不讀寫 public/database/ 下的正式資料
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
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
  const rootImageDir = join(dir, 'images')
  mkdirSync(rootImageDir, { recursive: true })
  writeFileSync(join(rootImageDir, 'present.png'), '')
  writeFileSync(
    join(gtmcDir, 'normal.md'),
    `# 正常文件\n${'內容'.repeat(30)}\n[404 片段](./404.md#標題) ` +
      '![根目錄圖片](/images/present.png) ![圖片](img/missing.png)'
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
    // Dictionary.txt 是獨立的待審翻譯候選來源，不隸屬已核准的正式詞典
    assert.equal(report.sources.legacy_dictionary_txt.malformedLineCount, 1)
    assert.equal(report.sources.legacy_dictionary_txt.file, 'public/database/Dictionary.txt')

    assert.equal(report.sources.techmc_glossary.encoding, 'utf-8-bom')
    assert.deepEqual(report.sources.techmc_glossary.columns, [
      'Category',
      'Short Form',
      'Full Form (English)'
    ])
    assert.equal(report.sources.techmc_glossary.rowCount, 2)
    assert.equal(report.sources.techmc_glossary.emptyShortFormCount, 1)

    assert.equal(report.sources.gtmc.fileCount, 3)
    assert.deepEqual(report.sources.gtmc.fileTypeBreakdown, { normal: 1, stub: 1, not_found: 1 })
    assert.deepEqual(report.sources.gtmc.encodingBreakdown, { 'utf-8': 3, 'utf-8-bom': 0 })
    assert.equal(report.sources.gtmc.duplicateWithLegacyCsvCount, 0)
    assert.equal(report.sources.gtmc.brokenLinkCount, 1)
  })

  // 欄名必須取自實際表頭列，而非第一筆資料的鍵；否則沒有資料列時會誤報 0 欄，
  // 連帶讓 D1 誤判成欄位缺失
  it('詞彙表只有表頭沒有資料列時，仍正確登記欄名與 D1 狀態', () => {
    writeFileSync(
      join(rootDir, 'public', 'database', 'TechMC Glossary.csv'),
      '﻿Category,term,definition\n'
    )

    const glossary = buildReport(rootDir).sources.techmc_glossary
    assert.equal(glossary.rowCount, 0)
    assert.deepEqual(glossary.columns, ['Category', 'term', 'definition'])
    assert.equal(glossary.columnCount, 3)
    const d1 = glossary.knownDefects.find((d) => d.id === 'D1')
    assert.equal(d1?.active, false, 'term 與 definition 都在表頭，D1 不應判定為存在')
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

  // 彙總統計對「改寫正文但不動任何計數」的變更完全無感，
  // 逐檔雜湊是唯一能攔下這類靜默變更的機制
  it('僅改寫 GTMC 正文而不影響任何統計時，仍以逐檔雜湊偵測到變更', () => {
    runAudit(rootDir, ['--write'], { log: () => {}, error: () => {} })

    const target = join(rootDir, 'public', 'database', 'gtmc-database', 'normal.md')
    const before = readFileSync(target, 'utf-8')
    // 同樣一個標題、同樣沒有連結、長度同樣超過 stub 門檻，只換掉正文字元
    const after = `# 正常文件\n${'改寫'.repeat(30)}\n![圖片](img/missing.png)`
    writeFileSync(target, after)

    const baselineStats = JSON.parse(
      readFileSync(join(rootDir, 'docs', 'data-audit.json'), 'utf-8')
    ).sources.gtmc
    const currentStats = buildReport(rootDir).sources.gtmc
    // 先確認這確實是統計無法察覺的變更
    assert.notEqual(before, after)
    assert.deepEqual(currentStats, baselineStats)

    const { log, io } = makeIo()
    const exitCode = runAudit(rootDir, [], io)
    assert.equal(exitCode, 1)
    assert.ok(
      log.some((line) => line.includes('fileHashes') && line.includes('normal.md')),
      '差異報告應指名變更的檔案'
    )
  })

  // schema 漂移必須看得出「哪一欄變了」，而不是只丟出一個 hash 變化
  it('欄位改名時，差異報告指出具體欄位而非只有雜湊變化', () => {
    runAudit(rootDir, ['--write'], { log: () => {}, error: () => {} })

    // 模擬 D1 那類缺陷：把 Short Form 改名為 term
    const glossary = join(rootDir, 'public', 'database', 'TechMC Glossary.csv')
    writeFileSync(
      glossary,
      '﻿' + 'Category,term,Full Form (English)\n' + 'A,BUD,Block Update Detector\n'
    )

    const { log, io } = makeIo()
    assert.equal(runAudit(rootDir, [], io), 1)
    const report = log.join('\n')
    assert.ok(report.includes('columns'), '應指出欄位清單變化')
    assert.ok(report.includes('term'), '應點名新欄位')
  })

  it('新增可選欄位時，區分出「只有部分記錄有」的欄位', () => {
    runAudit(rootDir, ['--write'], { log: () => {}, error: () => {} })

    const dbJsonPath = join(rootDir, 'public', 'database', 'database.json')
    const machines = JSON.parse(readFileSync(dbJsonPath, 'utf-8'))
    machines[0].newOptionalField = 'x'
    writeFileSync(dbJsonPath, JSON.stringify(machines))

    const { log, io } = makeIo()
    assert.equal(runAudit(rootDir, [], io), 1)
    const report = log.join('\n')
    assert.ok(report.includes('fieldInventory'))
    assert.ok(report.includes('newOptionalField'))
  })

  // 「來源新增」是 T0.3 點名要報告的情境，不能因為雜湊清單寫死檔名而漏掉
  it('在資料根目錄新增來源檔案時會被偵測到', () => {
    runAudit(rootDir, ['--write'], { log: () => {}, error: () => {} })

    writeFileSync(join(rootDir, 'public', 'database', 'newsource.csv'), 'a,b\n1,2\n')

    const { log, io } = makeIo()
    assert.equal(runAudit(rootDir, [], io), 1)
    assert.ok(log.some((line) => line.includes('newsource.csv')))
  })

  it('執行期產生的檔案不納入雜湊，不會造成假差異', () => {
    runAudit(rootDir, ['--write'], { log: () => {}, error: () => {} })

    const db = join(rootDir, 'public', 'database')
    writeFileSync(join(db, 'submissions.json'), '{"generated":true}')
    writeFileSync(join(db, 'knowledge.db'), 'binary')
    writeFileSync(join(db, 'knowledge.db-wal'), 'wal')

    const { log, io } = makeIo()
    assert.equal(runAudit(rootDir, [], io), 0, log.join('\n'))
  })

  // 來源檔消失是變更的一種，要有可讀報告而不是 ENOENT 堆疊
  it('來源檔被刪除時回傳非零並輸出可讀訊息，不拋出未處理例外', () => {
    runAudit(rootDir, ['--write'], { log: () => {}, error: () => {} })
    rmSync(join(rootDir, 'public', 'database', 'database.csv'))

    const { error, io } = makeIo()
    const exitCode = runAudit(rootDir, [], io)
    assert.equal(exitCode, 1)
    assert.ok(error.some((line) => line.includes('無法完成資料盤點')))
  })

  it('逐檔雜湊可偵測新增與刪除來源檔案', () => {
    runAudit(rootDir, ['--write'], { log: () => {}, error: () => {} })

    const added = join(rootDir, 'public', 'database', 'gtmc-database', 'img', 'new.png')
    mkdirSync(dirname(added), { recursive: true })
    writeFileSync(added, Buffer.from([1, 2, 3]))

    const { log, io } = makeIo()
    assert.equal(runAudit(rootDir, [], io), 1)
    assert.ok(log.some((line) => line.includes('new.png')))
  })
})
