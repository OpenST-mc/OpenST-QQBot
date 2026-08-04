// scripts/eval-machines.ts 的單元測試
// 涵蓋 T1.5a 要求：穩定排序、資料雜湊變更、baseline 不一致、少於 top-5 結果
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MachineEntry } from '../src/services/data'
import {
  computeMachineBaseline,
  compareMachineBaseline,
  validateMachineBaseline,
  buildMachineBaselineQueries,
  runEvalMachines,
  MachineBaseline,
  MACHINE_BASELINE_SCHEMA_VERSION,
  MACHINE_DATABASE_RELATIVE_PATH
} from './eval-machines'

function machine(name: string, subId: string, tags: string[] = []): MachineEntry {
  return { name, subId, author: 'Unknown', tags, description: '' }
}

// computeMachineBaseline() 只需要一個真實存在的檔案路徑來算 SHA-256，
// 內容與 machines 陣列可各自獨立控制，避免測試依賴真正的 database.json
function writeTempDatabaseFile(dir: string, content: string): string {
  const filePath = join(dir, 'database.json')
  writeFileSync(filePath, content)
  return filePath
}

// 最小可用的假查詢陣列，僅供不關心 queries 內容本身的測試使用
const SINGLE_TEST_QUERY = [{ id: 'q1', query: '打包机推薦' }]

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'eval-machines-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('computeMachineBaseline 穩定排序', () => {
  it('相同輸入重複執行得到完全相同的案例陣列（含並列分數的順序）', () => {
    const machines: MachineEntry[] = [
      machine('打包机A', 'sub-a', ['打包']),
      machine('打包机B', 'sub-b', ['打包']),
      machine('打包机C', 'sub-c', ['打包'])
    ]
    const dbFile = writeTempDatabaseFile(tmpDir, JSON.stringify(machines))
    const queries = [{ id: 'q1', query: '打包机推薦' }]

    const first = computeMachineBaseline(machines, dbFile, queries)
    const second = computeMachineBaseline(machines, dbFile, queries)

    assert.deepEqual(first, second)
    assert.deepEqual(first.cases[0].topSubIds, ['sub-a', 'sub-b', 'sub-c'])
  })
})

describe('computeMachineBaseline 少於 top-5 結果', () => {
  it('命中筆數少於 5 筆時保留實際筆數，不補齊', () => {
    const machines: MachineEntry[] = [
      machine('分类机', 'sub-x', ['分类']),
      machine('分类机二号', 'sub-y', ['分类'])
    ]
    const dbFile = writeTempDatabaseFile(tmpDir, JSON.stringify(machines))
    const queries = [{ id: 'q1', query: '分类机推薦' }]

    const baseline = computeMachineBaseline(machines, dbFile, queries)

    assert.equal(baseline.cases[0].topSubIds.length, 2)
    assert.deepEqual(baseline.cases[0].topSubIds, ['sub-x', 'sub-y'])
  })

  it('完全沒有命中時回傳空陣列', () => {
    const machines: MachineEntry[] = [machine('打包机', 'sub-a', ['打包'])]
    const dbFile = writeTempDatabaseFile(tmpDir, JSON.stringify(machines))
    const queries = [{ id: 'q1', query: '完全不相關的查詢字串' }]

    const baseline = computeMachineBaseline(machines, dbFile, queries)

    assert.deepEqual(baseline.cases[0].topSubIds, [])
  })
})

describe('computeMachineBaseline 資料雜湊變更', () => {
  it('database.json 內容不同時 databaseSha256 不同', () => {
    const machines: MachineEntry[] = [machine('打包机', 'sub-a', ['打包'])]
    const fileA = writeTempDatabaseFile(tmpDir, '[]')
    const baselineA = computeMachineBaseline(machines, fileA, SINGLE_TEST_QUERY)

    const otherDir = mkdtempSync(join(tmpdir(), 'eval-machines-b-'))
    try {
      const fileB = writeTempDatabaseFile(otherDir, '[{"changed":true}]')
      const baselineB = computeMachineBaseline(machines, fileB, SINGLE_TEST_QUERY)
      assert.notEqual(baselineA.databaseSha256, baselineB.databaseSha256)
    } finally {
      rmSync(otherDir, { recursive: true, force: true })
    }
  })

  it('database.json 內容相同時 databaseSha256 相同', () => {
    const machines: MachineEntry[] = [machine('打包机', 'sub-a', ['打包'])]
    const fileA = writeTempDatabaseFile(tmpDir, '[{"same":true}]')
    const baselineA = computeMachineBaseline(machines, fileA, SINGLE_TEST_QUERY)
    const baselineB = computeMachineBaseline(machines, fileA, SINGLE_TEST_QUERY)
    assert.equal(baselineA.databaseSha256, baselineB.databaseSha256)
  })

  // 本倉庫 core.autocrlf=true：同一次提交在 Windows／Linux checkout 出來的
  // database.json 位元組不同（CRLF／LF）。雜湊必須先正規化換行，否則同一份
  // 已提交內容會在不同平台算出不同 baseline，造成假差異
  it('僅換行符不同（CRLF／LF）時 databaseSha256 相同', () => {
    const machines: MachineEntry[] = [machine('打包机', 'sub-a', ['打包'])]
    const fileLf = writeTempDatabaseFile(tmpDir, '[\n  {"a":1}\n]\n')
    const otherDir = mkdtempSync(join(tmpdir(), 'eval-machines-crlf-'))
    try {
      const fileCrlf = writeTempDatabaseFile(otherDir, '[\r\n  {"a":1}\r\n]\r\n')
      const baselineLf = computeMachineBaseline(machines, fileLf, SINGLE_TEST_QUERY)
      const baselineCrlf = computeMachineBaseline(machines, fileCrlf, SINGLE_TEST_QUERY)
      assert.equal(baselineLf.databaseSha256, baselineCrlf.databaseSha256)
    } finally {
      rmSync(otherDir, { recursive: true, force: true })
    }
  })
})

describe('buildMachineBaselineQueries 從 questions.json 讀取覆蓋率', () => {
  function writeQuestions(dir: string, entries: unknown[]): string {
    const filePath = join(dir, 'questions.json')
    writeFileSync(filePath, JSON.stringify(entries))
    return filePath
  }

  it('只取 category=machine_recommendation 的題目，其他分類被排除', () => {
    const file = writeQuestions(tmpDir, [
      { id: 'machine-001', category: 'machine_recommendation', question: '推薦打包机' },
      { id: 'term-001', category: 'term_definition', question: '無關題目' }
    ])
    const queries = buildMachineBaselineQueries(file)
    const ids = queries.map((q) => q.id)
    assert.ok(ids.includes('machine-001'))
    assert.ok(!ids.includes('term-001'))
  })

  it('題庫增加新的 machine_recommendation 題目時，回傳的查詢集合會多出該題', () => {
    const file = writeQuestions(tmpDir, [
      { id: 'machine-001', category: 'machine_recommendation', question: '推薦打包机' }
    ])
    const before = buildMachineBaselineQueries(file).map((q) => q.id)
    assert.ok(before.includes('machine-001'))
    assert.ok(!before.includes('machine-999'))

    writeQuestions(tmpDir, [
      { id: 'machine-001', category: 'machine_recommendation', question: '推薦打包机' },
      { id: 'machine-999', category: 'machine_recommendation', question: '新題目' }
    ])
    const after = buildMachineBaselineQueries(file).map((q) => q.id)
    assert.ok(after.includes('machine-999'))
  })

  it('questions.json 沒有任何 machine_recommendation 題目時拋出錯誤', () => {
    const file = writeQuestions(tmpDir, [
      { id: 'term-001', category: 'term_definition', question: '無關題目' }
    ])
    assert.throws(() => buildMachineBaselineQueries(file), /machine_recommendation/)
  })

  it('題庫 id 與補充查詢 id 撞名時拋出錯誤', () => {
    const file = writeQuestions(tmpDir, [
      { id: 'name-001', category: 'machine_recommendation', question: '撞名題目' }
    ])
    assert.throws(() => buildMachineBaselineQueries(file), /id 重複/)
  })

  it('questions.json 格式錯誤（非陣列）時拋出錯誤而非靜默回傳空集合', () => {
    const filePath = join(tmpDir, 'questions.json')
    writeFileSync(filePath, JSON.stringify({ not: 'an array' }))
    assert.throws(() => buildMachineBaselineQueries(filePath), /陣列/)
  })
})

function makeBaseline(overrides: Partial<MachineBaseline> = {}): MachineBaseline {
  return {
    schemaVersion: MACHINE_BASELINE_SCHEMA_VERSION,
    databasePath: MACHINE_DATABASE_RELATIVE_PATH,
    databaseSha256: 'hash-1',
    cases: [{ id: 'q1', query: '打包机推薦', topSubIds: ['sub-a', 'sub-b'] }],
    ...overrides
  }
}

describe('compareMachineBaseline baseline 不一致', () => {
  it('完全一致時沒有差異', () => {
    const baseline = makeBaseline()
    const current = makeBaseline()
    const result = compareMachineBaseline(baseline, current)
    assert.deepEqual(result.diffs, [])
    assert.equal(result.databaseChanged, false)
  })

  it('top-5 sub_id 順序不同時回報差異', () => {
    const baseline = makeBaseline()
    const current = makeBaseline({
      cases: [{ id: 'q1', query: '打包机推薦', topSubIds: ['sub-b', 'sub-a'] }]
    })
    const result = compareMachineBaseline(baseline, current)
    assert.equal(result.diffs.length, 1)
    assert.match(result.diffs[0], /q1/)
  })

  it('案例被移除或新增時回報差異', () => {
    const baseline = makeBaseline()
    const current = makeBaseline({
      cases: [{ id: 'q2', query: '新查詢', topSubIds: [] }]
    })
    const result = compareMachineBaseline(baseline, current)
    assert.equal(result.diffs.length, 2)
    assert.ok(result.diffs.some((d) => d.includes('q1') && d.includes('移除')))
    assert.ok(result.diffs.some((d) => d.includes('q2') && d.includes('新增')))
  })

  it('databaseSha256 不同時標記 databaseChanged 且視為 diff（即使 top-5 沒變）', () => {
    const baseline = makeBaseline({ databaseSha256: 'hash-1' })
    const current = makeBaseline({ databaseSha256: 'hash-2' })
    const result = compareMachineBaseline(baseline, current)
    assert.equal(result.databaseChanged, true)
    assert.equal(result.diffs.length, 1)
    assert.match(result.diffs[0], /SHA-256/)
  })
})

describe('validateMachineBaseline 重複 ID 與格式錯誤', () => {
  it('cases 內有重複 id 時拋出錯誤', () => {
    const malformed = {
      schemaVersion: MACHINE_BASELINE_SCHEMA_VERSION,
      databasePath: MACHINE_DATABASE_RELATIVE_PATH,
      databaseSha256: 'hash-1',
      cases: [
        { id: 'q1', query: 'A', topSubIds: ['sub-a'] },
        { id: 'q1', query: 'B', topSubIds: ['sub-b'] }
      ]
    }
    assert.throws(() => validateMachineBaseline(malformed, 'test'), /重複 id/)
  })

  it('缺少必要欄位時拋出錯誤而非靜默通過', () => {
    assert.throws(() => validateMachineBaseline({ cases: [] }, 'test'), /格式不正確/)
  })

  it('case 缺少 topSubIds 時拋出錯誤', () => {
    const malformed = {
      schemaVersion: 1,
      databasePath: MACHINE_DATABASE_RELATIVE_PATH,
      databaseSha256: 'hash-1',
      cases: [{ id: 'q1', query: 'A' }]
    }
    assert.throws(() => validateMachineBaseline(malformed, 'test'), /cases\[0\]/)
  })

  it('合法形狀不拋出錯誤', () => {
    assert.doesNotThrow(() => validateMachineBaseline(makeBaseline(), 'test'))
  })
})

// 端對端：透過 runEvalMachines() 驅動真正的 loadMachineDatabase()/searchMachines()，
// 用暫時切換 cwd 的方式指向 fixture 目錄，模擬「必須在倉庫根目錄執行」的慣例
const DEFAULT_TEST_QUESTION_BANK = [
  { id: 'machine-001', category: 'machine_recommendation', question: '推薦打包机' },
  { id: 'term-001', category: 'term_definition', question: '無關題目，用來驗證分類會被過濾' }
]

describe('runEvalMachines CLI', () => {
  let originalCwd: string

  function seedFixtureRepo(
    dir: string,
    machines: unknown[],
    questions: unknown[] = DEFAULT_TEST_QUESTION_BANK
  ): void {
    const dbDir = join(dir, 'public', 'database')
    mkdirSync(dbDir, { recursive: true })
    writeFileSync(join(dbDir, 'database.json'), JSON.stringify(machines))

    const evalDir = join(dir, 'eval')
    mkdirSync(evalDir, { recursive: true })
    writeFileSync(join(evalDir, 'questions.json'), JSON.stringify(questions))
  }

  beforeEach(() => {
    originalCwd = process.cwd()
  })

  afterEach(() => {
    process.chdir(originalCwd)
  })

  it('--write 產生 baseline，之後預設模式比對通過', () => {
    seedFixtureRepo(tmpDir, [
      { name: '打包机', author: 'A', tags: ['打包'], description: '', sub_id: 'sub-a' }
    ])
    process.chdir(tmpDir)

    const logs: string[] = []
    const io = { log: (m: string) => logs.push(m), error: (m: string) => logs.push(m) }

    const writeExit = runEvalMachines(tmpDir, ['--write'], io)
    assert.equal(writeExit, 0)

    const baselinePath = join(tmpDir, 'eval', 'baseline-machines.json')
    const written = JSON.parse(readFileSync(baselinePath, 'utf-8')) as MachineBaseline
    assert.equal(written.schemaVersion, MACHINE_BASELINE_SCHEMA_VERSION)

    const verifyExit = runEvalMachines(tmpDir, [], io)
    assert.equal(verifyExit, 0)
  })

  it('沒有 baseline 檔案時預設模式回傳非零並提示先用 --write', () => {
    seedFixtureRepo(tmpDir, [])
    process.chdir(tmpDir)

    const logs: string[] = []
    const io = { log: (m: string) => logs.push(m), error: (m: string) => logs.push(m) }

    const exit = runEvalMachines(tmpDir, [], io)
    assert.equal(exit, 1)
    assert.ok(logs.some((l) => l.includes('--write')))
  })

  it('machines 資料變動導致 top-5 不一致時預設模式回傳非零', () => {
    seedFixtureRepo(tmpDir, [
      { name: '打包机', author: 'A', tags: ['打包'], description: '', sub_id: 'sub-a' }
    ])
    process.chdir(tmpDir)
    const io = { log: () => {}, error: () => {} }
    runEvalMachines(tmpDir, ['--write'], io)

    seedFixtureRepo(tmpDir, [
      { name: '打包机', author: 'A', tags: ['打包'], description: '', sub_id: 'sub-b' }
    ])

    const logs: string[] = []
    const verifyIo = { log: (m: string) => logs.push(m), error: (m: string) => logs.push(m) }
    const exit = runEvalMachines(tmpDir, [], verifyIo)
    assert.equal(exit, 1)
    assert.ok(logs.some((l) => l.includes('不一致')))
  })

  it('baseline 檔案是損壞的 JSON 時回傳非零，不拋出未捕捉例外', () => {
    seedFixtureRepo(tmpDir, [
      { name: '打包机', author: 'A', tags: ['打包'], description: '', sub_id: 'sub-a' }
    ])
    process.chdir(tmpDir)
    mkdirSync(join(tmpDir, 'eval'), { recursive: true })
    writeFileSync(join(tmpDir, 'eval', 'baseline-machines.json'), '{ not valid json')

    const logs: string[] = []
    const io = { log: (m: string) => logs.push(m), error: (m: string) => logs.push(m) }

    let exit = -1
    assert.doesNotThrow(() => {
      exit = runEvalMachines(tmpDir, [], io)
    })
    assert.equal(exit, 1)
    assert.ok(logs.some((l) => l.includes('JSON')))
  })

  it('baseline 檔案缺少必要欄位時回傳非零，不拋出未捕捉例外', () => {
    seedFixtureRepo(tmpDir, [
      { name: '打包机', author: 'A', tags: ['打包'], description: '', sub_id: 'sub-a' }
    ])
    process.chdir(tmpDir)
    mkdirSync(join(tmpDir, 'eval'), { recursive: true })
    writeFileSync(join(tmpDir, 'eval', 'baseline-machines.json'), JSON.stringify({ cases: [] }))

    const logs: string[] = []
    const io = { log: (m: string) => logs.push(m), error: (m: string) => logs.push(m) }

    let exit = -1
    assert.doesNotThrow(() => {
      exit = runEvalMachines(tmpDir, [], io)
    })
    assert.equal(exit, 1)
    assert.ok(logs.some((l) => l.includes('格式不正確')))
  })

  it('baseline 檔案內有重複 case id 時回傳非零，不拋出未捕捉例外', () => {
    seedFixtureRepo(tmpDir, [
      { name: '打包机', author: 'A', tags: ['打包'], description: '', sub_id: 'sub-a' }
    ])
    process.chdir(tmpDir)
    mkdirSync(join(tmpDir, 'eval'), { recursive: true })
    const duplicateBaseline = {
      schemaVersion: MACHINE_BASELINE_SCHEMA_VERSION,
      databasePath: MACHINE_DATABASE_RELATIVE_PATH,
      databaseSha256: 'irrelevant',
      cases: [
        { id: 'dup', query: 'A', topSubIds: [] },
        { id: 'dup', query: 'B', topSubIds: [] }
      ]
    }
    writeFileSync(
      join(tmpDir, 'eval', 'baseline-machines.json'),
      JSON.stringify(duplicateBaseline)
    )

    const logs: string[] = []
    const io = { log: (m: string) => logs.push(m), error: (m: string) => logs.push(m) }

    let exit = -1
    assert.doesNotThrow(() => {
      exit = runEvalMachines(tmpDir, [], io)
    })
    assert.equal(exit, 1)
    assert.ok(logs.some((l) => l.includes('重複 id')))
  })

  // 對應覆蓋率疑慮：machine_recommendation 題目改由 questions.json 直接讀取，
  // 題庫新增題目後，即使沒有人手動同步 eval-machines.ts，驗證也必須自動
  // 偵測到覆蓋範圍變化並要求審核，而不是悄悄用舊的查詢集合通過
  it('questions.json 新增 machine_recommendation 題目後，驗證會偵測到新案例', () => {
    seedFixtureRepo(
      tmpDir,
      [{ name: '打包机', author: 'A', tags: ['打包'], description: '', sub_id: 'sub-a' }],
      [{ id: 'machine-001', category: 'machine_recommendation', question: '推薦打包机' }]
    )
    process.chdir(tmpDir)
    const writeIo = { log: () => {}, error: () => {} }
    runEvalMachines(tmpDir, ['--write'], writeIo)

    seedFixtureRepo(
      tmpDir,
      [{ name: '打包机', author: 'A', tags: ['打包'], description: '', sub_id: 'sub-a' }],
      [
        { id: 'machine-001', category: 'machine_recommendation', question: '推薦打包机' },
        { id: 'machine-999', category: 'machine_recommendation', question: '新增的題目' }
      ]
    )

    const logs: string[] = []
    const verifyIo = { log: (m: string) => logs.push(m), error: (m: string) => logs.push(m) }
    const exit = runEvalMachines(tmpDir, [], verifyIo)
    assert.equal(exit, 1)
    assert.ok(logs.some((l) => l.includes('machine-999') && l.includes('新增')))
  })
})
