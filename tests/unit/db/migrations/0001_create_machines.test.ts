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
  process.cwd(), 'src', 'db', 'migrations', '0001_create_machines.sql'
)

const temporaryDirectories: string[] = []

function createFixtureDatabase(): import('better-sqlite3').Database {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openst-db-machines-'))
  temporaryDirectories.push(directory)
  const migrationsPath = path.join(directory, 'migrations')
  fs.mkdirSync(migrationsPath)
  fs.copyFileSync(MIGRATION_SOURCE, path.join(migrationsPath, '0001_create_machines.sql'))

  const database = createDatabase(path.join(directory, 'knowledge.db'))
  runMigrations(database, migrationsPath)
  return database
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('machines 与 machine_tags 表建立且带必要栏位', () => {
  const database = createFixtureDatabase()

  const machineColumns = database.prepare('PRAGMA table_info(machines)').all() as Array<{
    name: string
    notnull: number
    pk: number
  }>
  const machineColumnNames = machineColumns.map((column) => column.name)
  assert.deepEqual(machineColumnNames.sort(), [
    'author', 'created_at', 'description', 'filename', 'id',
    'name', 'preview_path', 'status', 'sub_id', 'updated_at'
  ])
  assert.equal(machineColumns.find((c) => c.name === 'id')!.pk, 1)
  assert.equal(machineColumns.find((c) => c.name === 'preview_path')!.notnull, 1)
  assert.equal(machineColumns.find((c) => c.name === 'name')!.notnull, 1)

  const tagColumns = database.prepare('PRAGMA table_info(machine_tags)').all() as Array<{
    name: string
  }>
  assert.deepEqual(tagColumns.map((c) => c.name).sort(), ['machine_id', 'tag'])

  database.close()
})

test('status 只接受审核状态合法值', () => {
  const database = createFixtureDatabase()
  const insert = database.prepare(`
    INSERT INTO machines (
      id, name, author, description, preview_path, filename, sub_id, status,
      created_at, updated_at
    ) VALUES (
      @id, @name, @author, @description, @previewPath, @filename, @subId, @status, @now, @now
    )
  `)

  insert.run({
    id: 'm1',
    name: 'test machine',
    author: 'author',
    description: 'desc',
    previewPath: '/preview.webp',
    filename: 'a.litematic',
    subId: 'sub-1',
    status: 'approved',
    now: '2026-08-03T00:00:00.000Z'
  })

  assert.throws(() => {
    insert.run({
      id: 'm2',
      name: 'test machine 2',
      author: 'author',
      description: 'desc',
      previewPath: '/preview.webp',
      filename: 'b.litematic',
      subId: 'sub-2',
      status: 'not_a_real_status',
      now: '2026-08-03T00:00:00.000Z'
    })
  }, /CHECK constraint failed/)

  database.close()
})

test('status CHECK 接受 REVIEW_STATUSES 的每一个合法值', () => {
  const database = createFixtureDatabase()
  const insert = database.prepare(`
    INSERT INTO machines (
      id, name, author, description, preview_path, filename, sub_id, status,
      created_at, updated_at
    ) VALUES (
      @id, @name, @author, @description, @previewPath, @filename, @subId, @status, @now, @now
    )
  `)

  for (const status of REVIEW_STATUSES) {
    assert.doesNotThrow(() => {
      insert.run({
        id: `status-${status}`,
        name: 'a',
        author: 'a',
        description: 'a',
        previewPath: '/p.webp',
        filename: 'a.litematic',
        subId: `sub-${status}`,
        status,
        now: '2026-08-03T00:00:00.000Z'
      })
    }, `CHECK 应接受 enums.ts 中的合法值: ${status}`)
  }

  database.close()
})

test('sub_id 唯一，重复插入报错', () => {
  const database = createFixtureDatabase()
  const insert = database.prepare(`
    INSERT INTO machines (
      id, name, author, description, preview_path, filename, sub_id, status,
      created_at, updated_at
    ) VALUES (
      @id, @name, @author, @description, @previewPath, @filename, @subId, @status, @now, @now
    )
  `)

  insert.run({
    id: 'm1', name: 'a', author: 'a', description: 'a', previewPath: '/p.webp',
    filename: 'a.litematic', subId: 'dup', status: 'approved',
    now: '2026-08-03T00:00:00.000Z'
  })

  assert.throws(() => {
    insert.run({
      id: 'm2', name: 'b', author: 'b', description: 'b', previewPath: '/p.webp',
      filename: 'b.litematic', subId: 'dup', status: 'approved',
      now: '2026-08-03T00:00:00.000Z'
    })
  }, /UNIQUE constraint failed: machines\.sub_id/)

  database.close()
})

test('machine_tags 删除机器时级联删除标签', () => {
  const database = createFixtureDatabase()
  database.prepare(`
    INSERT INTO machines (
      id, name, author, description, preview_path, filename, sub_id, status,
      created_at, updated_at
    ) VALUES ('m1', 'a', 'a', 'a', '/p.webp', 'a.litematic', 'sub-1', 'approved',
      '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z')
  `).run()
  const insertTag = database.prepare(
    'INSERT INTO machine_tags (machine_id, tag) VALUES (?, ?)'
  )
  insertTag.run('m1', '1.20+')
  insertTag.run('m1', '可堆叠')

  const before = database.prepare(
    'SELECT COUNT(*) AS count FROM machine_tags'
  ).get() as { count: number }
  assert.equal(before.count, 2)

  database.prepare('DELETE FROM machines WHERE id = ?').run('m1')

  const after = database.prepare(
    'SELECT COUNT(*) AS count FROM machine_tags'
  ).get() as { count: number }
  assert.equal(after.count, 0)

  database.close()
})

test('同一机器重复标签因复合主键拒绝', () => {
  const database = createFixtureDatabase()
  database.prepare(`
    INSERT INTO machines (
      id, name, author, description, preview_path, filename, sub_id, status,
      created_at, updated_at
    ) VALUES ('m1', 'a', 'a', 'a', '/p.webp', 'a.litematic', 'sub-1', 'approved',
      '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z')
  `).run()
  database.prepare('INSERT INTO machine_tags (machine_id, tag) VALUES (?, ?)').run('m1', '1.20+')

  assert.throws(() => {
    database.prepare('INSERT INTO machine_tags (machine_id, tag) VALUES (?, ?)').run('m1', '1.20+')
  }, /UNIQUE constraint failed/)

  database.close()
})
