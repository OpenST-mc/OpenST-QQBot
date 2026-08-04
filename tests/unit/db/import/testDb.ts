// T1.2 匯入工具测试共用的 fixture：套用真实 0001_core.sql 到临时资料库
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { createDatabase } from '../../../../src/db/connection'
import { runMigrations } from '../../../../src/db/migrate'

const REAL_MIGRATIONS_DIRECTORY = path.join(process.cwd(), 'src', 'db', 'migrations')

export function createMigratedDatabase(): {
  database: Database.Database
  directory: string
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openst-import-db-'))
  const database = createDatabase(path.join(directory, 'knowledge.db'))
  runMigrations(database, REAL_MIGRATIONS_DIRECTORY)
  return { database, directory }
}

export function cleanupDatabase(database: Database.Database, directory: string): void {
  database.close()
  fs.rmSync(directory, { recursive: true, force: true })
}
