// 依文件名字典序执行 migration，并在同一 transaction 内记录已完成版本
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { getDatabase } from './connection'

// 版本号固定 4 位，确保文件名字典序与版本号数值顺序一致
const MIGRATION_FILE_PATTERN = /^(\d{4})_[A-Za-z0-9_-]+\.sql$/
const DEFAULT_MIGRATIONS_DIRECTORY = path.join(__dirname, 'migrations')

export class MigrationError extends Error {
  constructor(
    public readonly version: string,
    public readonly originalError: unknown
  ) {
    const detail = originalError instanceof Error
      ? originalError.message
      : String(originalError)
    super(`Migration ${version} 失败: ${detail}`)
    this.name = 'MigrationError'
  }
}

interface Migration {
  version: string
  path: string
}

function listMigrations(migrationsDirectory: string): Migration[] {
  // 只跑 tsc 而未执行 npm run build 时目录不会存在，需给出可操作的提示
  if (!fs.existsSync(migrationsDirectory)) {
    throw new Error(
      `Migration 目录不存在: ${migrationsDirectory}，请先执行 npm run build`
    )
  }

  const filenames = fs.readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)

  const versions = new Set<string>()
  return filenames.map((filename) => {
    const match = MIGRATION_FILE_PATTERN.exec(filename)
    if (match === null) {
      throw new Error(`Migration 文件名不合法: ${filename}`)
    }

    const version = match[1]
    if (versions.has(version)) {
      throw new Error(`Migration 版本重复: ${version}`)
    }
    versions.add(version)

    return {
      version,
      path: path.join(migrationsDirectory, filename)
    }
  })
}

export function runMigrations(
  database: Database.Database = getDatabase(),
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  for (const migration of listMigrations(migrationsDirectory)) {
    const applied = database
      .prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
      .get(migration.version)
    if (applied !== undefined) {
      continue
    }

    try {
      const sql = fs.readFileSync(migration.path, 'utf8')
      database.transaction(() => {
        database.exec(sql)
        database.prepare(`
          INSERT INTO schema_migrations (version, applied_at)
          VALUES (?, ?)
        `).run(migration.version, new Date().toISOString())
      })()
    } catch (error: unknown) {
      throw new MigrationError(migration.version, error)
    }
  }
}
