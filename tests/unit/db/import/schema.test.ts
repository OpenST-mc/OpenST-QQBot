import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import Database from 'better-sqlite3'
import { cleanupDatabase, createMigratedDatabase } from './testDb'

let fixtures: Array<{ database: Database.Database; directory: string }> = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    cleanupDatabase(fixture.database, fixture.directory)
  }
})

function open(): Database.Database {
  const fixture = createMigratedDatabase()
  fixtures.push(fixture)
  return fixture.database
}

test('0001_core.sql 建立全部七张表', () => {
  const database = open()
  const tables = database
    .prepare<unknown[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    )
    .all()
    .map((row) => row.name)

  for (const expected of [
    'sources',
    'import_runs',
    'raw_assets',
    'content_quality_flags',
    'ai_jobs',
    'ai_runs',
    'extraction_candidates'
  ]) {
    assert.ok(tables.includes(expected), `缺少表: ${expected}`)
  }
})

test('sources.visibility 只接受 internal 或 public', () => {
  const database = open()
  const insert = (visibility: string) =>
    database.prepare(`
      INSERT INTO sources (source_key, type, name, visibility, trust_level, created_at)
      VALUES (?, 'document_collection', 'name', ?, 'high', '2026-01-01T00:00:00.000Z')
    `).run(`key-${visibility}`, visibility)

  insert('internal')
  insert('public')
  assert.throws(() => insert('secret'), /CHECK constraint failed/)
})

test('raw_assets 同来源同雜湊同 logical_record_no 不可重複写入', () => {
  const database = open()
  database.prepare(`
    INSERT INTO sources (source_key, type, name, visibility, trust_level, created_at)
    VALUES ('gtmc', 'document_collection', 'GTMC', 'public', 'medium', '2026-01-01T00:00:00.000Z')
  `).run()
  const sourceId = database
    .prepare<unknown[], { id: number }>('SELECT id FROM sources WHERE source_key = ?')
    .get('gtmc')!.id

  const insertAsset = () =>
    database.prepare(`
      INSERT INTO raw_assets (
        source_id, asset_key, relative_path, logical_record_no, content_hash,
        encoding, byte_size, status, created_at, updated_at
      ) VALUES (?, ?, 'a.md', 1, 'hash-1', 'utf-8', 10, 'discovered', ?, ?)
    `).run(sourceId, 'gtmc:a.md:1:hash-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')

  insertAsset()
  assert.throws(insertAsset, /UNIQUE constraint failed/)
})

test('content_quality_flags 依 ON DELETE CASCADE 随 raw_assets 一併删除', () => {
  const database = open()
  database.prepare(`
    INSERT INTO sources (source_key, type, name, visibility, trust_level, created_at)
    VALUES ('gtmc', 'document_collection', 'GTMC', 'public', 'medium', '2026-01-01T00:00:00.000Z')
  `).run()
  const sourceId = database
    .prepare<unknown[], { id: number }>('SELECT id FROM sources WHERE source_key = ?')
    .get('gtmc')!.id
  database.prepare(`
    INSERT INTO raw_assets (
      source_id, asset_key, relative_path, logical_record_no, content_hash,
      encoding, byte_size, status, created_at, updated_at
    ) VALUES (?, 'gtmc:a.md:1:hash-1', 'a.md', 1, 'hash-1', 'utf-8', 10, 'discovered', ?, ?)
  `).run(sourceId, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  const assetId = database
    .prepare<unknown[], { id: number }>('SELECT id FROM raw_assets WHERE asset_key = ?')
    .get('gtmc:a.md:1:hash-1')!.id
  database.prepare(`
    INSERT INTO content_quality_flags (
      raw_asset_id, flag_type, detected_by, status, created_at
    ) VALUES (?, 'stub', 'rule', 'open', ?)
  `).run(assetId, '2026-01-01T00:00:00.000Z')

  database.prepare('DELETE FROM raw_assets WHERE id = ?').run(assetId)

  const remaining = database
    .prepare<unknown[], { count: number }>(
      'SELECT COUNT(*) AS count FROM content_quality_flags'
    )
    .get()!.count
  assert.equal(remaining, 0)
})
