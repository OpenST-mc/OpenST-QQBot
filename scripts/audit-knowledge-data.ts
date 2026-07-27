// 可重現資料盤點稽核器（T0.3）
// 對 KNOWLEDGE_SYSTEM_PLAN.md「資料盤點實測結果」涵蓋的 7 個實體來源做唯讀統計
// 預設模式：計算結果與已提交的 docs/data-audit.json 比對，有差異時印出報告並非零結束
// --write 模式：覆寫 docs/data-audit.json 作為新基準（供人工審核後接受）
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join, relative, dirname, extname } from 'path'
import { parse } from 'csv-parse/sync'
import {
  RawMachineEntry,
  MachineStats,
  computeMachineStats,
  LegacyCsvRecord,
  LegacyCsvStats,
  computeLegacyCsvStats,
  computeLegacyCsvContentHashes,
  LegacyMarkdownStats,
  computeLegacyMarkdownStats,
  DictionaryTxtStats,
  computeDictionaryTxtStats,
  RawDictionaryEntry,
  DictionaryEntryStats,
  computeDictionaryEntryStats,
  GlossaryStats,
  computeGlossaryStats,
  hasUtf8Bom,
  extractRelativeLinkTargets,
  classifyGtmcFile,
  diffValues
} from './lib/auditCalculations'

function readText(rootDir: string, relPath: string): string {
  return readFileSync(join(rootDir, relPath), 'utf-8')
}

function parseCsv<T>(content: string): T[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true
  }) as T[]
}

// database.json 機器目錄稽核
interface MachineAudit extends MachineStats {
  file: string
}

function auditMachines(rootDir: string): MachineAudit {
  const file = 'public/database/database.json'
  const entries = JSON.parse(readText(rootDir, file)) as RawMachineEntry[]

  return { file, ...computeMachineStats(entries) }
}

// database.csv 歷史知識庫稽核（RFC 4180，禁止按換行切割）
interface LegacyCsvAudit extends LegacyCsvStats {
  file: string
}

function readLegacyCsvRecords(rootDir: string): LegacyCsvRecord[] {
  const content = readText(rootDir, 'public/database/database.csv')
  return parseCsv<LegacyCsvRecord>(content)
}

function auditLegacyCsv(records: LegacyCsvRecord[]): LegacyCsvAudit {
  return {
    file: 'public/database/database.csv',
    ...computeLegacyCsvStats(records)
  }
}

// database.md 歷史學習日誌稽核
interface LegacyMarkdownAudit extends LegacyMarkdownStats {
  file: string
}

function auditLegacyMarkdown(rootDir: string): LegacyMarkdownAudit {
  const file = 'public/database/database.md'
  return { file, ...computeLegacyMarkdownStats(readText(rootDir, file)) }
}

// dictionary/ 稽核（英文詞條 + 中文翻譯 + 補充候選 Dictionary.txt）
interface DictionaryAudit extends DictionaryEntryStats {
  entriesDir: string
  entryFileCount: number
  zhTranslationCount: number
  dictionaryTxt: DictionaryTxtStats & { file: string }
}

function auditDictionary(rootDir: string): DictionaryAudit {
  const entriesDir = 'public/database/dictionary/entries'
  const entryFiles = readdirSync(join(rootDir, entriesDir)).filter((f) =>
    f.endsWith('.json')
  )
  const entries = entryFiles.map(
    (fileName) =>
      JSON.parse(readText(rootDir, `${entriesDir}/${fileName}`)) as RawDictionaryEntry
  )

  const zhTranslations = JSON.parse(
    readText(rootDir, 'public/database/dictionary/zh-translations.json')
  ) as { entries: Array<{ id: string }> }
  const zhIds = new Set(zhTranslations.entries.map((e) => e.id))

  const dictionaryTxtFile = 'public/database/Dictionary.txt'
  const dictionaryTxtStats = computeDictionaryTxtStats(
    readText(rootDir, dictionaryTxtFile)
  )

  return {
    entriesDir,
    entryFileCount: entryFiles.length,
    ...computeDictionaryEntryStats(entries, zhIds),
    zhTranslationCount: zhTranslations.entries.length,
    dictionaryTxt: { file: dictionaryTxtFile, ...dictionaryTxtStats }
  }
}

// TechMC Glossary.csv 稽核
interface GlossaryAudit extends GlossaryStats {
  file: string
  hasBom: boolean
}

function auditGlossary(rootDir: string): GlossaryAudit {
  const file = 'public/database/TechMC Glossary.csv'
  const rawBuffer = readFileSync(join(rootDir, file))
  const hasBom = hasUtf8Bom(rawBuffer)
  const content = rawBuffer.toString('utf-8')

  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true
  }) as Array<Record<string, string>>
  const header = rows.length > 0 ? Object.keys(rows[0]) : []

  return { file, hasBom, ...computeGlossaryStats(rows, header) }
}

// gtmc-database/ 稽核：檔案數、結構區塊、疑似 404/stub、與歷史 CSV 逐字重複、失效相對連結
interface GtmcAudit {
  dir: string
  fileCount: number
  headingBlockCount: number
  fileTypeBreakdown: Record<'normal' | 'stub' | 'not_found', number>
  duplicateWithLegacyCsvCount: number
  brokenLinkCount: number
}

function walkMarkdownFiles(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue
    }
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...walkMarkdownFiles(full))
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      result.push(full)
    }
  }
  return result
}

function auditGtmc(rootDir: string, legacyCsvHashes: Set<string>): GtmcAudit {
  const dir = 'public/database/gtmc-database'
  const files = walkMarkdownFiles(join(rootDir, dir))

  let headingBlockCount = 0
  const fileTypeBreakdown: Record<'normal' | 'stub' | 'not_found', number> = {
    normal: 0,
    stub: 0,
    not_found: 0
  }
  let duplicateWithLegacyCsvCount = 0
  let brokenLinkCount = 0

  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf-8')
    const fileName = filePath.split(/[\\/]/).pop() || ''
    const classification = classifyGtmcFile(fileName, content)

    headingBlockCount += classification.headingCount
    fileTypeBreakdown[classification.fileType]++
    if (legacyCsvHashes.has(classification.contentHash)) {
      duplicateWithLegacyCsvCount++
    }

    const fileDir = dirname(filePath)
    for (const target of extractRelativeLinkTargets(content)) {
      if (!existsSync(join(fileDir, target))) {
        brokenLinkCount++
      }
    }
  }

  return {
    dir,
    fileCount: files.length,
    headingBlockCount,
    fileTypeBreakdown,
    duplicateWithLegacyCsvCount,
    brokenLinkCount
  }
}

export interface AuditReport {
  sources: {
    openst_machine_submission: MachineAudit
    legacy_database_csv: LegacyCsvAudit
    legacy_database_markdown: LegacyMarkdownAudit
    storage_tech_dictionary: DictionaryAudit
    techmc_glossary: GlossaryAudit
    gtmc: GtmcAudit
  }
}

export function buildReport(rootDir: string): AuditReport {
  const legacyCsvRecords = readLegacyCsvRecords(rootDir)
  const legacyCsvHashes = computeLegacyCsvContentHashes(legacyCsvRecords)

  return {
    sources: {
      openst_machine_submission: auditMachines(rootDir),
      legacy_database_csv: auditLegacyCsv(legacyCsvRecords),
      legacy_database_markdown: auditLegacyMarkdown(rootDir),
      storage_tech_dictionary: auditDictionary(rootDir),
      techmc_glossary: auditGlossary(rootDir),
      gtmc: auditGtmc(rootDir, legacyCsvHashes)
    }
  }
}

export interface AuditIo {
  log: (message: string) => void
  error: (message: string) => void
}

// CLI 主邏輯，回傳 process exit code；抽出方便測試以任意 rootDir/argv 呼叫
export function runAudit(rootDir: string, argv: string[], io: AuditIo): number {
  const dataAuditPath = join(rootDir, 'docs', 'data-audit.json')
  const shouldWrite = argv.includes('--write')
  const report = buildReport(rootDir)

  if (shouldWrite) {
    mkdirSync(dirname(dataAuditPath), { recursive: true })
    writeFileSync(dataAuditPath, `${JSON.stringify(report, null, 2)}\n`)
    io.log(`已寫入基準快照: ${relative(rootDir, dataAuditPath)}`)
    return 0
  }

  if (!existsSync(dataAuditPath)) {
    io.error(`找不到基準快照 ${relative(rootDir, dataAuditPath)}，請先執行 --write 產生`)
    return 1
  }

  const baseline = JSON.parse(readFileSync(dataAuditPath, 'utf-8')) as AuditReport
  const diffs = diffValues('sources', baseline.sources, report.sources)

  if (diffs.length === 0) {
    io.log('資料盤點無差異')
    return 0
  }

  io.log('偵測到資料盤點差異，需人工審核後以 --write 接受新基準：')
  for (const diff of diffs) {
    io.log(`  ${diff}`)
  }
  return 1
}

function main(): void {
  const rootDir = join(__dirname, '..')
  process.exitCode = runAudit(rootDir, process.argv.slice(2), console)
}

if (require.main === module) {
  main()
}
