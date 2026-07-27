// 資料盤點稽核器（T0.3）的純運算層
// 只處理已讀入記憶體的字串／已解析資料，不做任何檔案系統存取，方便單元測試
import { createHash } from 'crypto'

// 統一 sha256，用於重複內容偵測
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

// 依 wc -l 慣例切行：檔案以換行結尾時不把結尾後的空字串算成一行
export function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

// database.json 機器目錄
export interface RawMachineEntry {
  id: string
  name: string
  author: string
  tags: string[]
  description: string
  sub_id: string
}

export interface MachineStats {
  machineCount: number
  uniqueSubIdCount: number
  totalTagCount: number
  emptyDescriptionCount: number
}

export function computeMachineStats(entries: RawMachineEntry[]): MachineStats {
  const subIds = new Set(entries.map((m) => m.sub_id))
  const totalTagCount = entries.reduce((sum, m) => sum + (m.tags?.length || 0), 0)
  const emptyDescriptionCount = entries.filter(
    (m) => !m.description || m.description.trim() === ''
  ).length

  return {
    machineCount: entries.length,
    uniqueSubIdCount: subIds.size,
    totalTagCount,
    emptyDescriptionCount
  }
}

// database.csv 歷史知識庫（RFC 4180 解析後的邏輯記錄）
export interface LegacyCsvRecord {
  topic?: string
  content?: string
}

export interface LegacyCsvStats {
  logicalRecordCount: number
  emptyContentCount: number
  duplicateContentHashCount: number
  multilineRecordCount: number
}

export function computeLegacyCsvStats(records: LegacyCsvRecord[]): LegacyCsvStats {
  const hashCounts = new Map<string, number>()
  let emptyContentCount = 0
  let multilineRecordCount = 0

  for (const record of records) {
    const topic = record.topic || ''
    const body = record.content || ''
    if (body.trim() === '') {
      emptyContentCount++
    }
    if (body.includes('\n')) {
      multilineRecordCount++
    }
    const hash = sha256(`${topic}\n${body}`)
    hashCounts.set(hash, (hashCounts.get(hash) || 0) + 1)
  }

  let duplicateContentHashCount = 0
  for (const count of hashCounts.values()) {
    if (count > 1) {
      duplicateContentHashCount += count - 1
    }
  }

  return {
    logicalRecordCount: records.length,
    emptyContentCount,
    duplicateContentHashCount,
    multilineRecordCount
  }
}

// database.csv 每筆記錄內容雜湊，供 GTMC 逐字重複比對使用
export function computeLegacyCsvContentHashes(records: LegacyCsvRecord[]): Set<string> {
  return new Set(records.map((r) => sha256((r.content || '').trim())))
}

// database.md 歷史學習日誌
export interface LegacyMarkdownStats {
  lineCount: number
  headingCount: number
}

export function computeLegacyMarkdownStats(content: string): LegacyMarkdownStats {
  const lines = splitLines(content)
  const headingCount = lines.filter((line) => /^#{1,6}\s/.test(line)).length

  return {
    lineCount: lines.length,
    headingCount
  }
}

// Dictionary.txt 補充候選
export interface DictionaryTxtStats {
  lineCount: number
  malformedLineCount: number
}

export function computeDictionaryTxtStats(content: string): DictionaryTxtStats {
  const lines = splitLines(content)
  const nonEmptyLines = lines.filter((line) => line.trim() !== '')
  const malformedLineCount = nonEmptyLines.filter((line) => !line.includes('-')).length

  return {
    lineCount: lines.length,
    malformedLineCount
  }
}

// dictionary/entries 英文詞條
export interface RawDictionaryEntry {
  id: string
  terms: string[]
  definition: string
  status: string
}

export interface DictionaryEntryStats {
  recordCount: number
  emptyDefinitionCount: number
  duplicateIdCount: number
  termOverlapCount: number
  statusBreakdown: Record<string, number>
  missingZhTranslationCount: number
}

export function computeDictionaryEntryStats(
  entries: RawDictionaryEntry[],
  zhIds: Set<string>
): DictionaryEntryStats {
  const seenIds = new Map<string, number>()
  const termOwners = new Map<string, Set<string>>()
  const statusBreakdown: Record<string, number> = {}
  let emptyDefinitionCount = 0

  for (const entry of entries) {
    seenIds.set(entry.id, (seenIds.get(entry.id) || 0) + 1)
    statusBreakdown[entry.status] = (statusBreakdown[entry.status] || 0) + 1
    if (!entry.definition || entry.definition.trim() === '') {
      emptyDefinitionCount++
    }
    for (const term of entry.terms || []) {
      const key = term.trim().toLowerCase()
      if (!termOwners.has(key)) {
        termOwners.set(key, new Set())
      }
      termOwners.get(key)!.add(entry.id)
    }
  }

  let duplicateIdCount = 0
  for (const count of seenIds.values()) {
    if (count > 1) {
      duplicateIdCount += count - 1
    }
  }

  let termOverlapCount = 0
  for (const owners of termOwners.values()) {
    if (owners.size > 1) {
      termOverlapCount++
    }
  }

  const missingZhTranslationCount = [...seenIds.keys()].filter(
    (id) => !zhIds.has(id)
  ).length

  return {
    recordCount: seenIds.size,
    emptyDefinitionCount,
    duplicateIdCount,
    termOverlapCount,
    statusBreakdown,
    missingZhTranslationCount
  }
}

// TechMC Glossary.csv（記錄實際欄名，不假設 D1 的錯誤欄名存在）
export interface GlossaryStats {
  columnCount: number
  rowCount: number
  emptyShortFormCount: number
  emptyFullFormCount: number
  duplicateShortFormCount: number
}

export function computeGlossaryStats(
  rows: Array<Record<string, string>>,
  header: string[]
): GlossaryStats {
  const shortFormCounts = new Map<string, number>()
  let emptyShortFormCount = 0
  let emptyFullFormCount = 0

  for (const row of rows) {
    const shortForm = (row['Short Form'] || '').trim()
    const fullForm = (row['Full Form (English)'] || '').trim()
    if (shortForm === '') {
      emptyShortFormCount++
    } else {
      const key = shortForm.toLowerCase()
      shortFormCounts.set(key, (shortFormCounts.get(key) || 0) + 1)
    }
    if (fullForm === '') {
      emptyFullFormCount++
    }
  }

  let duplicateShortFormCount = 0
  for (const count of shortFormCounts.values()) {
    if (count > 1) {
      duplicateShortFormCount += count - 1
    }
  }

  return {
    columnCount: header.length,
    rowCount: rows.length,
    emptyShortFormCount,
    emptyFullFormCount,
    duplicateShortFormCount
  }
}

// 判斷 CSV 原始 buffer 開頭是否為 UTF-8 BOM
export function hasUtf8Bom(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
}

// 抓取 Markdown 連結與圖片的相對路徑目標，只檢查非 http(s)、非錨點連結
export function extractRelativeLinkTargets(content: string): string[] {
  const targets: string[] = []
  const linkRegex = /!?\[[^\]]*]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(content)) !== null) {
    const target = match[1].split(' ')[0].trim()
    if (target === '' || /^https?:\/\//.test(target) || target.startsWith('#')) {
      continue
    }
    targets.push(target)
  }
  return targets
}

// 單一 gtmc Markdown 檔案的文件類型分類：not_found（檔名含 404）、
// stub（去除標題後正文過短）、normal（其餘）；用於 T0.3「文件類型」盤點指標
export type GtmcFileType = 'not_found' | 'stub' | 'normal'

export interface GtmcFileClassification {
  headingCount: number
  fileType: GtmcFileType
  contentHash: string
}

export function classifyGtmcFile(fileName: string, content: string): GtmcFileClassification {
  const lines = content.split('\n')
  const headingCount = lines.filter((line) => /^#{1,6}\s/.test(line)).length
  const bodyWithoutHeadings = lines
    .filter((line) => !/^#{1,6}\s/.test(line))
    .join('\n')
    .trim()

  let fileType: GtmcFileType = 'normal'
  if (fileName.toLowerCase().includes('404')) {
    fileType = 'not_found'
  } else if (bodyWithoutHeadings.length < 50) {
    fileType = 'stub'
  }

  return {
    headingCount,
    fileType,
    contentHash: sha256(content.trim())
  }
}

// 遞迴比較兩個 JSON 相容值，回傳差異路徑清單
export function diffValues(
  pathPrefix: string,
  previous: unknown,
  current: unknown
): string[] {
  if (JSON.stringify(previous) === JSON.stringify(current)) {
    return []
  }

  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)

  if (isPlainObject(previous) && isPlainObject(current)) {
    const keys = new Set([...Object.keys(previous), ...Object.keys(current)])
    const diffs: string[] = []
    for (const key of keys) {
      diffs.push(...diffValues(`${pathPrefix}.${key}`, previous[key], current[key]))
    }
    return diffs
  }

  return [`${pathPrefix}: ${JSON.stringify(previous)} -> ${JSON.stringify(current)}`]
}
