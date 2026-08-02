// SQLite 连接只在此模块创建，确保所有连接使用相同的安全与并发设定
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { KNOWLEDGE_DATABASE_PATH } from '../config'

let database: Database.Database | null = null

export function createDatabase(databasePath: string): Database.Database {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })

  const connection = new Database(databasePath)
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')

  return connection
}

export function getDatabase(): Database.Database {
  if (database === null) {
    database = createDatabase(KNOWLEDGE_DATABASE_PATH)
  }

  return database
}

export function closeDatabase(): void {
  if (database !== null) {
    database.close()
    database = null
  }
}
