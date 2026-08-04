import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, test } from 'node:test'
import { createDatabase } from '../../../../src/db/connection'
import { runMigrations } from '../../../../src/db/migrate'
import { REVIEW_STATUSES } from '../../../../src/db/enums'

// __dirname 指向 dist-tests 编译产物，tsc 不复制 .sql，需从仓库根目录取原始文件
// AGENTS.md 规定测试须在仓库根目录运行，process.cwd() 因此可靠
const MIGRATION_SOURCE = path.join(
  process.cwd(), 'src', 'db', 'migrations', '0002_machines.sql'
)

const temporaryDirectories: string[] = []

function createFixtureDatabase(): import('better-sqlite3').Database {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openst-db-machines-'))
  temporaryDirectories.push(directory)
  const migrationsPath = path.join(directory, 'migrations')
  fs.mkdirSync(migrationsPath)
  fs.copyFileSync(MIGRATION_SOURCE, path.join(migrationsPath, '0002_machines.sql'))

  const database = createDatabase(path.join(directory, 'knowledge.db'))
  runMigrations(database, migrationsPath)
  return database
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

interface MachineOverrides {
  name?: string
  author?: string
  description?: string
  previewPath?: string
  filename?: string
  subId: string
  status?: string
  sourceId?: string
  sourceHash?: string
}

// source_id 与 sub_id 分开生成，避免测试互相冲突；其余栏位有 DEFAULT 时可省略
function insertMachine(
  database: import('better-sqlite3').Database,
  overrides: MachineOverrides
): number {
  const now = '2026-08-03T00:00:00.000Z'
  const result = database.prepare(`
    INSERT INTO machines (
      source_id, name, author, description, preview_path, filename, sub_id,
      status, source_hash, created_at, updated_at
    ) VALUES (
      @sourceId, @name, @author, @description, @previewPath, @filename, @subId,
      @status, @sourceHash, @now, @now
    )
  `).run({
    sourceId: overrides.sourceId ?? `source-${overrides.subId}`,
    name: overrides.name ?? 'test machine',
    author: overrides.author ?? 'author',
    description: overrides.description ?? 'desc',
    previewPath: overrides.previewPath ?? '/preview.webp',
    filename: overrides.filename ?? 'a.litematic',
    subId: overrides.subId,
    status: overrides.status ?? 'approved',
    sourceHash: overrides.sourceHash ?? 'a'.repeat(64),
    now
  })
  return Number(result.lastInsertRowid)
}

test('machines / machine_tags / machine_relations 表建立且带必要栏位', () => {
  const database = createFixtureDatabase()

  const machineColumns = database.prepare('PRAGMA table_info(machines)').all() as Array<{
    name: string
    notnull: number
    pk: number
    dflt_value: string | null
  }>
  const machineColumnNames = machineColumns.map((column) => column.name)
  assert.deepEqual(machineColumnNames.sort(), [
    'author', 'created_at', 'description', 'filename', 'id', 'name',
    'preview_path', 'source_hash', 'source_id', 'status', 'sub_id', 'updated_at'
  ])
  assert.equal(machineColumns.find((c) => c.name === 'id')!.pk, 1)
  assert.equal(machineColumns.find((c) => c.name === 'source_id')!.notnull, 1)
  assert.equal(machineColumns.find((c) => c.name === 'source_hash')!.notnull, 1)
  assert.equal(machineColumns.find((c) => c.name === 'author')!.dflt_value, "'Unknown'")
  assert.equal(machineColumns.find((c) => c.name === 'status')!.dflt_value, "'approved'")

  const tagColumns = database.prepare('PRAGMA table_info(machine_tags)').all() as Array<{
    name: string
  }>
  assert.deepEqual(tagColumns.map((c) => c.name).sort(), ['machine_id', 'tag'])

  const relationColumns = database.prepare(
    'PRAGMA table_info(machine_relations)'
  ).all() as Array<{ name: string }>
  assert.deepEqual(relationColumns.map((c) => c.name).sort(), [
    'machine_id', 'related_machine_id', 'relation_type'
  ])

  database.close()
})

test('id 为自增主键，插入时不可手动指定且逐笔递增', () => {
  const database = createFixtureDatabase()
  const firstId = insertMachine(database, { subId: 'sub-1' })
  const secondId = insertMachine(database, { subId: 'sub-2' })
  assert.equal(typeof firstId, 'number')
  assert.equal(secondId, firstId + 1)
  database.close()
})

test('author / description / preview_path / filename / status 有 DEFAULT，可省略插入', () => {
  const database = createFixtureDatabase()
  const now = '2026-08-03T00:00:00.000Z'
  const id = database.prepare(`
    INSERT INTO machines (source_id, name, sub_id, source_hash, created_at, updated_at)
    VALUES (@sourceId, @name, @subId, @sourceHash, @now, @now)
  `).run({
    sourceId: 'source-defaults', name: 'defaults machine', subId: 'sub-defaults',
    sourceHash: 'b'.repeat(64), now
  }).lastInsertRowid

  const row = database.prepare('SELECT * FROM machines WHERE id = ?').get(id) as {
    author: string
    description: string
    preview_path: string
    filename: string
    status: string
  }
  assert.equal(row.author, 'Unknown')
  assert.equal(row.description, '')
  assert.equal(row.preview_path, '')
  assert.equal(row.filename, '')
  assert.equal(row.status, 'approved')

  database.close()
})

test('status 只接受审核状态合法值', () => {
  const database = createFixtureDatabase()
  insertMachine(database, { subId: 'sub-1', status: 'approved' })

  assert.throws(() => {
    insertMachine(database, { subId: 'sub-2', status: 'not_a_real_status' })
  }, /CHECK constraint failed/)

  database.close()
})

test('status CHECK 接受 REVIEW_STATUSES 的每一个合法值', () => {
  const database = createFixtureDatabase()

  for (const status of REVIEW_STATUSES) {
    assert.doesNotThrow(() => {
      insertMachine(database, { subId: `sub-${status}`, status })
    }, `CHECK 应接受 enums.ts 中的合法值: ${status}`)
  }

  database.close()
})

test('sub_id 唯一，重复插入报错', () => {
  const database = createFixtureDatabase()
  insertMachine(database, { subId: 'dup' })

  assert.throws(() => {
    insertMachine(database, { subId: 'dup' })
  }, /UNIQUE constraint failed: machines\.sub_id/)

  database.close()
})

test('machine_tags 删除机器时级联删除标签', () => {
  const database = createFixtureDatabase()
  const machineId = insertMachine(database, { subId: 'sub-1' })

  const insertTag = database.prepare(
    'INSERT INTO machine_tags (machine_id, tag) VALUES (?, ?)'
  )
  insertTag.run(machineId, '1.20+')
  insertTag.run(machineId, '可堆叠')

  const before = database.prepare(
    'SELECT COUNT(*) AS count FROM machine_tags'
  ).get() as { count: number }
  assert.equal(before.count, 2)

  database.prepare('DELETE FROM machines WHERE id = ?').run(machineId)

  const after = database.prepare(
    'SELECT COUNT(*) AS count FROM machine_tags'
  ).get() as { count: number }
  assert.equal(after.count, 0)

  database.close()
})

test('同一机器重复标签因复合主键拒绝', () => {
  const database = createFixtureDatabase()
  const machineId = insertMachine(database, { subId: 'sub-1' })
  database.prepare('INSERT INTO machine_tags (machine_id, tag) VALUES (?, ?)').run(
    machineId, '1.20+'
  )

  assert.throws(() => {
    database.prepare('INSERT INTO machine_tags (machine_id, tag) VALUES (?, ?)').run(
      machineId, '1.20+'
    )
  }, /UNIQUE constraint failed/)

  database.close()
})

test('machine_relations 建表成功，可插入相容/替代等关系', () => {
  const database = createFixtureDatabase()
  const machineA = insertMachine(database, { subId: 'sub-a' })
  const machineB = insertMachine(database, { subId: 'sub-b' })

  database.prepare(`
    INSERT INTO machine_relations (machine_id, relation_type, related_machine_id)
    VALUES (?, ?, ?)
  `).run(machineA, 'supersedes', machineB)

  const row = database.prepare(
    'SELECT * FROM machine_relations WHERE machine_id = ?'
  ).get(machineA) as { relation_type: string; related_machine_id: number }
  assert.equal(row.relation_type, 'supersedes')
  assert.equal(row.related_machine_id, machineB)

  database.close()
})

test('machine_relations 拒绝机器关联自己', () => {
  const database = createFixtureDatabase()
  const machineA = insertMachine(database, { subId: 'sub-a' })

  assert.throws(() => {
    database.prepare(`
      INSERT INTO machine_relations (machine_id, relation_type, related_machine_id)
      VALUES (?, ?, ?)
    `).run(machineA, 'supersedes', machineA)
  }, /CHECK constraint failed/)

  database.close()
})

test('machine_relations 同一组关系重复插入因复合主键拒绝', () => {
  const database = createFixtureDatabase()
  const machineA = insertMachine(database, { subId: 'sub-a' })
  const machineB = insertMachine(database, { subId: 'sub-b' })
  const insertRelation = database.prepare(`
    INSERT INTO machine_relations (machine_id, relation_type, related_machine_id)
    VALUES (?, ?, ?)
  `)
  insertRelation.run(machineA, 'supersedes', machineB)

  assert.throws(() => {
    insertRelation.run(machineA, 'supersedes', machineB)
  }, /UNIQUE constraint failed/)

  database.close()
})

test('machine_relations 删除任一端机器时级联删除关系', () => {
  const database = createFixtureDatabase()
  const machineA = insertMachine(database, { subId: 'sub-a' })
  const machineB = insertMachine(database, { subId: 'sub-b' })
  database.prepare(`
    INSERT INTO machine_relations (machine_id, relation_type, related_machine_id)
    VALUES (?, ?, ?)
  `).run(machineA, 'supersedes', machineB)

  database.prepare('DELETE FROM machines WHERE id = ?').run(machineB)

  const after = database.prepare(
    'SELECT COUNT(*) AS count FROM machine_relations'
  ).get() as { count: number }
  assert.equal(after.count, 0)

  database.close()
})
