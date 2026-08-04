// T1.5a：機器推薦行為快照（baseline）生成與驗證
// 目的：在 T1.4a/T1.4b 把機器資料來源改接 SQLite 之前，記錄目前
// loadMachineDatabase() + searchMachines() 對一組查詢的 top-5 sub_id，
// 作為之後遷移「推薦行為不回歸」的比對依據。本檔案不修改、不重寫任何
// 推薦邏輯，只呼叫既有 src/services/data.ts 匯出的函式
// 預設模式：重跑現有邏輯並與已提交的 eval/baseline-machines.json 逐案比較
// --write 模式：覆寫 baseline 作為新基準（僅限審核通過的行為變更）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { loadMachineDatabase, searchMachines, MachineEntry } from '../src/services/data'
import { sha256, normalizeLineEndings } from './lib/auditCalculations'

export const MACHINE_BASELINE_SCHEMA_VERSION = 1
export const MACHINE_DATABASE_RELATIVE_PATH = 'public/database/database.json'
export const MACHINE_BASELINE_RELATIVE_PATH = 'eval/baseline-machines.json'

export interface MachineBaselineQuery {
  id: string
  query: string
}

export interface MachineBaselineCase extends MachineBaselineQuery {
  topSubIds: string[]
}

export interface MachineBaseline {
  schemaVersion: number
  databasePath: string
  databaseSha256: string
  cases: MachineBaselineCase[]
}

// 延伸自 eval/questions.json 的 machine_recommendation 題目（machine-001~004），
// 並補上名稱、命中作者、標籤、英文/版本詞與沒有命中的查詢，
// 確保 baseline 覆蓋 T1.5a 要求的全部查詢類型
export const MACHINE_BASELINE_QUERIES: MachineBaselineQuery[] = [
  { id: 'machine-001', query: '推薦適合 Java 1.20+ 的不可堆疊物品打包機器。' },
  { id: 'machine-002', query: '有作者是 Maizuma 的機器推薦嗎？' },
  { id: 'machine-003', query: '推薦一個有分類功能的機器。' },
  { id: 'machine-004', query: '我需要生電機器，目錄裡有哪些選擇？' },
  { id: 'name-001', query: '0t 堆肥桶可访问打包机怎么用？' },
  { id: 'author-001', query: 'Floppy 做过哪些机器？' },
  { id: 'tag-001', query: '潜影盒打包机相关的机器有哪些' },
  { id: 'version-001', query: '1.21.x 版本有哪些机器可以用' },
  { id: 'nohit-001', query: 'zzz这是一个不存在的查询关键字qwerty12345' }
]

function isMachineBaselineCase(value: unknown): value is MachineBaselineCase {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const c = value as Record<string, unknown>
  return (
    typeof c['id'] === 'string' &&
    typeof c['query'] === 'string' &&
    Array.isArray(c['topSubIds']) &&
    c['topSubIds'].every((s) => typeof s === 'string')
  )
}

// 驗證 baseline 形狀（不論來自已提交檔案的 JSON.parse 結果，或本次重新計算的
// 結果），並拒絕重複 case id——重複 id 若不擋下來，後續以 Map 建索引時會
// 靜默丟棄較早的那筆，讓「案例缺失」偵測失效
export function validateMachineBaseline(value: unknown, sourceLabel: string): MachineBaseline {
  const errors: string[] = []
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>

  if (typeof v['schemaVersion'] !== 'number') {
    errors.push('schemaVersion 必須是數字')
  }
  if (typeof v['databasePath'] !== 'string') {
    errors.push('databasePath 必須是字串')
  }
  if (typeof v['databaseSha256'] !== 'string') {
    errors.push('databaseSha256 必須是字串')
  }

  const rawCases = v['cases']
  if (!Array.isArray(rawCases)) {
    errors.push('cases 必須是陣列')
  } else {
    rawCases.forEach((c, index) => {
      if (!isMachineBaselineCase(c)) {
        errors.push(`cases[${index}] 缺少 id/query/topSubIds 或型別錯誤`)
      }
    })

    const validCases = rawCases.filter(isMachineBaselineCase)
    const ids = validCases.map((c) => c.id)
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
    if (duplicateIds.length > 0) {
      errors.push(`cases 內有重複 id：${duplicateIds.join(', ')}`)
    }
  }

  if (errors.length > 0) {
    throw new Error(`${sourceLabel} 格式不正確：${errors.join('；')}`)
  }
  return value as MachineBaseline
}

// 本倉庫 core.autocrlf=true，database.json 未在 .gitattributes 強制 LF：
// 同一次提交在 Windows／Linux checkout 出來的位元組不同，直接雜湊原始位元組
// 會讓 databaseSha256 隨平台跳動。換行正規化後再雜湊，做法與
// scripts/lib/auditCalculations.ts 的 hashSourceFile() 一致
function sha256TextFile(absolutePath: string): string {
  return sha256(normalizeLineEndings(readFileSync(absolutePath, 'utf-8')))
}

// 依既有 searchMachines() 對每個查詢重新計算 top-5 sub_id；不改動排序或比對邏輯，
// 只讀取其回傳結果。少於 5 筆時保留實際筆數，不補齊
export function computeMachineBaseline(
  machines: MachineEntry[],
  databaseAbsolutePath: string,
  queries: MachineBaselineQuery[] = MACHINE_BASELINE_QUERIES
): MachineBaseline {
  const cases = queries.map(({ id, query }) => ({
    id,
    query,
    topSubIds: searchMachines(query, machines).map((m) => m.subId)
  }))

  return {
    schemaVersion: MACHINE_BASELINE_SCHEMA_VERSION,
    databasePath: MACHINE_DATABASE_RELATIVE_PATH,
    databaseSha256: sha256TextFile(databaseAbsolutePath),
    cases
  }
}

export interface BaselineComparison {
  diffs: string[]
  databaseChanged: boolean
}

// 逐案比較 baseline 與目前重跑結果；比較 sub_id 陣列時保留順序，
// 因為排序（分數、並列時的原始順序）本身就是要保護的行為
export function compareMachineBaseline(
  baseline: MachineBaseline,
  current: MachineBaseline
): BaselineComparison {
  const diffs: string[] = []

  if (baseline.schemaVersion !== current.schemaVersion) {
    diffs.push(
      `schemaVersion 不一致：baseline=${baseline.schemaVersion} 目前=${current.schemaVersion}`
    )
  }
  if (baseline.databasePath !== current.databasePath) {
    diffs.push(
      `databasePath 不一致：baseline=${baseline.databasePath} 目前=${current.databasePath}`
    )
  }

  // 資料雜湊不符必須讓驗證失敗，不能只當作附註記錄：baseline 是綁定特定
  // database.json 內容的快照，內容一變就代表這份快照的有效性需要人工重新
  // 審核，即使剛好所有查詢的 top-5 sub_id 沒有改變也一樣
  const databaseChanged = baseline.databaseSha256 !== current.databaseSha256
  if (databaseChanged) {
    diffs.push(
      `${MACHINE_DATABASE_RELATIVE_PATH} 的 SHA-256 已變更：` +
        `baseline=${baseline.databaseSha256} 目前=${current.databaseSha256}` +
        '（需人工審核資料異動是否影響推薦結果，再以 --write 更新 baseline）'
    )
  }

  const baselineById = new Map(baseline.cases.map((c) => [c.id, c]))
  const currentById = new Map(current.cases.map((c) => [c.id, c]))

  for (const id of baselineById.keys()) {
    if (!currentById.has(id)) {
      diffs.push(`案例 ${id} 已從查詢集合移除`)
    }
  }
  for (const id of currentById.keys()) {
    if (!baselineById.has(id)) {
      diffs.push(`案例 ${id} 是新增查詢，baseline 尚未收錄，請審核後以 --write 補上`)
    }
  }

  for (const [id, baselineCase] of baselineById) {
    const currentCase = currentById.get(id)
    if (!currentCase) {
      continue
    }
    if (baselineCase.query !== currentCase.query) {
      diffs.push(`案例 ${id} 查詢字串已變更：baseline="${baselineCase.query}"`)
    }
    const baselineIds = baselineCase.topSubIds
    const currentIds = currentCase.topSubIds
    if (JSON.stringify(baselineIds) !== JSON.stringify(currentIds)) {
      diffs.push(
        `案例 ${id} top-5 sub_id 不一致：` +
          `baseline=[${baselineIds.join(', ')}] 目前=[${currentIds.join(', ')}]`
      )
    }
  }

  return { diffs, databaseChanged }
}

export interface EvalIo {
  log: (message: string) => void
  error: (message: string) => void
}

// CLI 主邏輯，回傳 process exit code；抽出方便測試以任意 rootDir/argv 呼叫
// 注意：rootDir 只決定 database.json 雜湊與 baseline 檔案的讀寫位置。
// loadMachineDatabase() 是既有函式、本 Track 不得修改，它內部一律以
// process.cwd() 解析相對路徑，不接受 rootDir 參數。呼叫端必須保證
// rootDir 等於當下的 process.cwd()（main() 直接取 process.cwd()；
// 測試需先 process.chdir(rootDir)），否則機器資料與雜湊/baseline
// 會分別來自兩個不同目錄
export function runEvalMachines(rootDir: string, argv: string[], io: EvalIo): number {
  const databaseAbsolutePath = join(rootDir, MACHINE_DATABASE_RELATIVE_PATH)
  const baselineAbsolutePath = join(rootDir, MACHINE_BASELINE_RELATIVE_PATH)
  const shouldWrite = argv.includes('--write')

  let current: MachineBaseline
  try {
    const machines = loadMachineDatabase()
    current = validateMachineBaseline(
      computeMachineBaseline(machines, databaseAbsolutePath),
      '目前重新計算的結果'
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    io.error(`無法重新計算機器推薦 baseline（資料可能已刪除或格式損壞）：${detail}`)
    return 1
  }

  if (shouldWrite) {
    mkdirSync(dirname(baselineAbsolutePath), { recursive: true })
    writeFileSync(baselineAbsolutePath, `${JSON.stringify(current, null, 2)}\n`)
    io.log(`已寫入機器推薦 baseline：${MACHINE_BASELINE_RELATIVE_PATH}`)
    return 0
  }

  if (!existsSync(baselineAbsolutePath)) {
    io.error(`找不到 baseline ${MACHINE_BASELINE_RELATIVE_PATH}，請先審核後以 --write 產生`)
    return 1
  }

  let baseline: MachineBaseline
  try {
    const raw = JSON.parse(readFileSync(baselineAbsolutePath, 'utf-8')) as unknown
    baseline = validateMachineBaseline(raw, MACHINE_BASELINE_RELATIVE_PATH)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    io.error(`無法讀取 baseline（JSON 損壞或格式不正確）：${detail}`)
    return 1
  }

  const { diffs } = compareMachineBaseline(baseline, current)

  if (diffs.length === 0) {
    io.log('機器推薦 baseline 無差異，top-5 sub_id 與記錄完全一致')
    return 0
  }

  io.log('偵測到機器推薦 baseline 差異，需人工審核後以 --write 接受新基準：')
  for (const diff of diffs) {
    io.log(`  ${diff}`)
  }
  return 1
}

function main(): void {
  const rootDir = process.cwd()
  process.exitCode = runEvalMachines(rootDir, process.argv.slice(2), console)
}

if (require.main === module) {
  main()
}
