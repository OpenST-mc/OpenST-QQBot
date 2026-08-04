import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import Database from 'better-sqlite3'
import { findSourceByKey, registerSource } from '../../../../src/db/import/sources'
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

test('registerSource 写入来源并回传完整记录', () => {
  const database = open()
  const record = registerSource(
    {
      sourceKey: 'gtmc',
      type: 'document_collection',
      name: 'GTMC 技术文件',
      license: 'CC BY-NC-SA 4.0',
      visibility: 'public',
      trustLevel: 'medium'
    },
    database
  )

  assert.equal(record.sourceKey, 'gtmc')
  assert.equal(record.visibility, 'public')
  assert.equal(record.creator, null)
  assert.ok(record.id > 0)
  assert.ok(record.createdAt.length > 0)

  const row = database
    .prepare<unknown[], { source_key: string }>('SELECT source_key FROM sources')
    .get()
  assert.equal(row?.source_key, 'gtmc')
})

test('registerSource 对同一 source_key 幂等且不覆盖既有栏位', () => {
  const database = open()
  registerSource(
    {
      sourceKey: 'techmc_glossary',
      type: 'glossary',
      name: 'TechMC Glossary',
      visibility: 'internal',
      trustLevel: 'low'
    },
    database
  )

  // 重複注册时改传不同的 visibility/trustLevel，验证既有记录不被覆写
  const second = registerSource(
    {
      sourceKey: 'techmc_glossary',
      type: 'glossary',
      name: 'TechMC Glossary',
      visibility: 'public',
      trustLevel: 'high'
    },
    database
  )

  assert.equal(second.visibility, 'internal')
  assert.equal(second.trustLevel, 'low')

  const count = database
    .prepare<unknown[], { count: number }>('SELECT COUNT(*) AS count FROM sources')
    .get()!.count
  assert.equal(count, 1)
})

test('findSourceByKey 找不到来源时回传 null', () => {
  const database = open()
  assert.equal(findSourceByKey('does-not-exist', database), null)
})
