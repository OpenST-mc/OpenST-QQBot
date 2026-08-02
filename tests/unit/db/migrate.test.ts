import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, test } from 'node:test'
import { KNOWLEDGE_DATABASE_PATH, PROJECT_ROOT } from '../../../src/config'
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

test('默认知识库与编译产物的 migration 路径不依赖当前工作目录', () => {
  assert.equal(path.isAbsolute(KNOWLEDGE_DATABASE_PATH), true)
  assert.equal(
    KNOWLEDGE_DATABASE_PATH,
    path.join(PROJECT_ROOT, 'public', 'database', 'knowledge.db')
  )
  assert.equal(fs.existsSync(path.join(process.cwd(), 'dist', 'db', 'migrations')), true)
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
