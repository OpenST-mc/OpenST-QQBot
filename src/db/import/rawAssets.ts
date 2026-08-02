// Raw 快照工具：仅登记来源路径、编码与正规化内容雜湊，正文永远只留在 Raw 目录檔案中，
// 不写入 SQLite（见 KNOWLEDGE_SYSTEM_PLAN.md「Raw 内容」政策）
// 同来源、同正规化雜湊、同 logical_record_no 的快照视为已匯入，重複调用直接回传既有记录
import Database from 'better-sqlite3'
import { getDatabase } from '../connection'
import { RawAssetStatus, assertRawAssetStatus } from '../enums'
import { findSourceByKey } from './sources'

export interface RawAssetSnapshotInput {
  sourceKey: string
  importRunId?: number
  relativePath: string
  logicalRecordNo?: number
  contentHash: string
  encoding: string
  byteSize: number
  status: RawAssetStatus
}

export interface RawAssetRecord {
  id: number
  sourceId: number
  importRunId: number | null
  assetKey: string
  relativePath: string
  logicalRecordNo: number | null
  contentHash: string
  encoding: string
  byteSize: number
  status: RawAssetStatus
  createdAt: string
  updatedAt: string
}

interface RawAssetRow {
  id: number
  source_id: number
  import_run_id: number | null
  asset_key: string
  relative_path: string
  logical_record_no: number | null
  content_hash: string
  encoding: string
  byte_size: number
  status: string
  created_at: string
  updated_at: string
}

function toRawAssetRecord(row: RawAssetRow): RawAssetRecord {
  return {
    id: row.id,
    sourceId: row.source_id,
    importRunId: row.import_run_id,
    assetKey: row.asset_key,
    relativePath: row.relative_path,
    logicalRecordNo: row.logical_record_no,
    contentHash: row.content_hash,
    encoding: row.encoding,
    byteSize: row.byte_size,
    status: assertRawAssetStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// asset_key 格式固定为 <source_key>:<relative_path>:<logical_record_no-or-file>:<sha256>
function buildAssetKey(
  sourceKey: string,
  relativePath: string,
  logicalRecordNo: number | null,
  contentHash: string
): string {
  const recordSegment = logicalRecordNo === null ? 'file' : String(logicalRecordNo)
  return `${sourceKey}:${relativePath}:${recordSegment}:${contentHash}`
}

// 记录一次 Raw 快照；来源必须已由 registerSource() 登记，否则拒绝写入
export function recordRawAssetSnapshot(
  input: RawAssetSnapshotInput,
  database: Database.Database = getDatabase()
): RawAssetRecord {
  assertRawAssetStatus(input.status)

  const source = findSourceByKey(input.sourceKey, database)
  if (source === null) {
    throw new Error(`来源未登记: ${input.sourceKey}，请先调用 registerSource()`)
  }

  const logicalRecordNo = input.logicalRecordNo ?? null

  // 应用层先查重，不依赖 UNIQUE INDEX 对 NULL 的处理：SQLite 视每个 NULL 为相异值，
  // 单靠索引无法挡下 logical_record_no 为 NULL（整档快照）时的重複写入
  const existing = database
    .prepare<[number, string, number | null], RawAssetRow>(`
      SELECT * FROM raw_assets
      WHERE source_id = ? AND content_hash = ? AND logical_record_no IS ?
    `)
    .get(source.id, input.contentHash, logicalRecordNo)
  if (existing !== undefined) {
    return toRawAssetRecord(existing)
  }

  const assetKey = buildAssetKey(
    source.sourceKey,
    input.relativePath,
    logicalRecordNo,
    input.contentHash
  )
  const now = new Date().toISOString()
  const result = database.prepare(`
    INSERT INTO raw_assets (
      source_id, import_run_id, asset_key, relative_path, logical_record_no,
      content_hash, encoding, byte_size, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    source.id,
    input.importRunId ?? null,
    assetKey,
    input.relativePath,
    logicalRecordNo,
    input.contentHash,
    input.encoding,
    input.byteSize,
    input.status,
    now,
    now
  )

  return toRawAssetRecord({
    id: Number(result.lastInsertRowid),
    source_id: source.id,
    import_run_id: input.importRunId ?? null,
    asset_key: assetKey,
    relative_path: input.relativePath,
    logical_record_no: logicalRecordNo,
    content_hash: input.contentHash,
    encoding: input.encoding,
    byte_size: input.byteSize,
    status: input.status,
    created_at: now,
    updated_at: now
  })
}
