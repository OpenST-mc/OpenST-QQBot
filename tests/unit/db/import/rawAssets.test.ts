import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import Database from 'better-sqlite3'
import { registerSource } from '../../../../src/db/import/sources'
import { recordRawAssetSnapshot } from '../../../../src/db/import/rawAssets'
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
  registerSource(
    {
      sourceKey: 'gtmc',
      type: 'document_collection',
      name: 'GTMC 技术文件',
      visibility: 'public',
      trustLevel: 'medium'
    },
    fixture.database
  )
  return fixture.database
}

test('recordRawAssetSnapshot 写入快照并组出固定格式的 asset_key', () => {
  const database = open()
  const record = recordRawAssetSnapshot(
    {
      sourceKey: 'gtmc',
      relativePath: 'gtmc-database/BlockUpdate/README.md',
      contentHash: 'abc123',
      encoding: 'utf-8',
      byteSize: 42,
      status: 'discovered'
    },
    database
  )

  assert.equal(
    record.assetKey,
    'gtmc:gtmc-database/BlockUpdate/README.md:file:abc123'
  )
  assert.equal(record.logicalRecordNo, null)
  assert.equal(record.status, 'discovered')
})

test('同来源同雜湊同 logical_record_no 重複快照回传既有记录，不新增', () => {
  const database = open()
  const input = {
    sourceKey: 'gtmc',
    relativePath: 'gtmc-database/BlockUpdate/README.md',
    logicalRecordNo: 3,
    contentHash: 'same-hash',
    encoding: 'utf-8',
    byteSize: 10,
    status: 'discovered' as const
  }

  const first = recordRawAssetSnapshot(input, database)
  const second = recordRawAssetSnapshot(input, database)

  assert.equal(first.id, second.id)
  const count = database
    .prepare<unknown[], { count: number }>('SELECT COUNT(*) AS count FROM raw_assets')
    .get()!.count
  assert.equal(count, 1)
})

test('同雜湊但不同 logical_record_no 各自建立独立快照', () => {
  const database = open()
  const base = {
    sourceKey: 'gtmc',
    relativePath: 'legacy/database.csv',
    contentHash: 'shared-hash',
    encoding: 'utf-8',
    byteSize: 5,
    status: 'discovered' as const
  }

  recordRawAssetSnapshot({ ...base, logicalRecordNo: 1 }, database)
  recordRawAssetSnapshot({ ...base, logicalRecordNo: 2 }, database)

  const count = database
    .prepare<unknown[], { count: number }>('SELECT COUNT(*) AS count FROM raw_assets')
    .get()!.count
  assert.equal(count, 2)
})

test('两次整档快照（logical_record_no 为 null）也视为重複，不新增第二笔', () => {
  const database = open()
  const input = {
    sourceKey: 'gtmc',
    relativePath: 'gtmc-database/BlockUpdate/README.md',
    contentHash: 'whole-file-hash',
    encoding: 'utf-8',
    byteSize: 20,
    status: 'discovered' as const
  }

  recordRawAssetSnapshot(input, database)
  recordRawAssetSnapshot(input, database)

  const count = database
    .prepare<unknown[], { count: number }>('SELECT COUNT(*) AS count FROM raw_assets')
    .get()!.count
  assert.equal(count, 1)
})

test('来源未登记时拒绝写入', () => {
  const database = open()
  assert.throws(
    () =>
      recordRawAssetSnapshot(
        {
          sourceKey: 'unknown_source',
          relativePath: 'a.md',
          contentHash: 'hash',
          encoding: 'utf-8',
          byteSize: 1,
          status: 'discovered'
        },
        database
      ),
    /来源未登记: unknown_source/
  )
})
