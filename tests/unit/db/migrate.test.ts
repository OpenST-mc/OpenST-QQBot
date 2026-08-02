import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, test } from 'node:test'
import { KNOWLEDGE_DATABASE_PATH } from '../../../src/config'
import { createDatabase } from '../../../src/db/connection'
import { MigrationError, runMigrations } from '../../../src/db/migrate'

const temporaryDirectories: string[] = []

function createFixture(): { databasePath: string; migrationsPath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openst-db-'))
  temporaryDirectories.push(directory)
  const migrationsPath = path.join(directory, 'migrations')
  fs.mkdirSync(migrationsPath)
  return { databasePath: path.join(directory, 'knowledge.db'), migrationsPath }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('migration 依文件名顺序执行且可重复运行', () => {
  const fixture = createFixture()
  fs.writeFileSync(
    path.join(fixture.migrationsPath, '0002_second.sql'),
    'INSERT INTO example (value) VALUES (\'second\');'
  )
  fs.writeFileSync(
    path.join(fixture.migrationsPath, '0001_first.sql'),
    'CREATE TABLE example (value TEXT NOT NULL);\n' +
      'INSERT INTO example (value) VALUES (\'first\');'
  )
  const database = createDatabase(fixture.databasePath)

  assert.equal(
    database.prepare<unknown[], { foreign_keys: number }>(
      'PRAGMA foreign_keys'
    ).get()!.foreign_keys,
    1
  )
  assert.equal(
    database.prepare<unknown[], { journal_mode: string }>(
      'PRAGMA journal_mode'
    ).get()!.journal_mode,
    'wal'
  )
  assert.equal(
    database.prepare<unknown[], { synchronous: number }>(
      'PRAGMA synchronous'
    ).get()!.synchronous,
    1
  )
  assert.equal(
    database.prepare<unknown[], { timeout: number }>(
      'PRAGMA busy_timeout'
    ).get()!.timeout,
    5000
  )

  runMigrations(database, fixture.migrationsPath)
  runMigrations(database, fixture.migrationsPath)

  assert.deepEqual(
    database.prepare('SELECT value FROM example ORDER BY rowid').all(),
    [{ value: 'first' }, { value: 'second' }]
  )
  assert.deepEqual(
    database.prepare('SELECT version FROM schema_migrations ORDER BY version').all(),
    [{ version: '0001' }, { version: '0002' }]
  )
  database.close()
})

test('默认知识库路径为绝对路径且不随当前工作目录改变', () => {
  assert.equal(path.isAbsolute(KNOWLEDGE_DATABASE_PATH), true)
  assert.deepEqual(
    KNOWLEDGE_DATABASE_PATH.split(path.sep).slice(-3),
    ['public', 'database', 'knowledge.db']
  )

  // 切换 cwd 后重新加载配置，路径必须由 __dirname 推导而非当前工作目录
  const configModulePath = require.resolve('../../../src/config')
  const originalCwd = process.cwd()
  process.chdir(os.tmpdir())
  try {
    delete require.cache[configModulePath]
    const reloaded = require('../../../src/config') as {
      KNOWLEDGE_DATABASE_PATH: string
    }
    assert.equal(reloaded.KNOWLEDGE_DATABASE_PATH, KNOWLEDGE_DATABASE_PATH)
  } finally {
    process.chdir(originalCwd)
    delete require.cache[configModulePath]
  }
})

test('拒绝非 4 位版本号的 migration 文件名', () => {
  const fixture = createFixture()
  fs.writeFileSync(path.join(fixture.migrationsPath, '1_first.sql'), 'SELECT 1;')
  const database = createDatabase(fixture.databasePath)

  assert.throws(
    () => runMigrations(database, fixture.migrationsPath),
    /Migration 文件名不合法: 1_first\.sql/
  )
  database.close()
})

test('同一版本号出现多个 migration 文件时报错', () => {
  const fixture = createFixture()
  fs.writeFileSync(path.join(fixture.migrationsPath, '0001_a.sql'), 'SELECT 1;')
  fs.writeFileSync(path.join(fixture.migrationsPath, '0001_b.sql'), 'SELECT 1;')
  const database = createDatabase(fixture.databasePath)

  assert.throws(
    () => runMigrations(database, fixture.migrationsPath),
    /Migration 版本重复: 0001/
  )
  database.close()
})

test('migration 目录不存在时提示先执行 npm run build', () => {
  const fixture = createFixture()
  const database = createDatabase(fixture.databasePath)

  assert.throws(
    () => runMigrations(database, path.join(fixture.migrationsPath, 'absent')),
    /Migration 目录不存在[\s\S]*npm run build/
  )
  database.close()
})

test('失败 migration 会回滚且不记录版本', () => {
  const fixture = createFixture()
  fs.writeFileSync(
    path.join(fixture.migrationsPath, '0001_broken.sql'),
    'CREATE TABLE incomplete (value TEXT);\n' +
      'INSERT INTO missing_table VALUES (1);'
  )
  const database = createDatabase(fixture.databasePath)

  let caught: unknown
  try {
    runMigrations(database, fixture.migrationsPath)
  } catch (error: unknown) {
    caught = error
  }
  assert.ok(caught instanceof MigrationError)
  assert.equal(caught.version, '0001')
  assert.match(caught.message, /no such table: missing_table/)
  assert.ok(caught.originalError instanceof Error)
  assert.equal(
    database.prepare<unknown[], { count: number }>(
      "SELECT COUNT(*) AS count FROM sqlite_master " +
        "WHERE type = 'table' AND name = 'incomplete'"
    ).get()!.count,
    0
  )
  assert.equal(
    database.prepare<unknown[], { count: number }>(
      'SELECT COUNT(*) AS count FROM schema_migrations'
    ).get()!.count,
    0
  )
  database.close()
})
