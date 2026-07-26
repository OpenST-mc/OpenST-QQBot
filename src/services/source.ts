// 自适应文件搜索服务
// 在 public/database/source/ 目录下搜索——不限文件格式
// 文本文件按内容匹配，二进制文件自动跳过
import fs from 'fs'
import path from 'path'
import { SOURCE_DATABASE_PATH } from '../config'

// 搜索结果
export interface SourceFile {
  // 相对于 source/ 的文件路径
  path: string
  // 文件内容（最多返回 8000 字符）
  content: string
}

// 单文件最大返回字符数
const MAX_CONTENT_LENGTH = 8000

// 常见二进制/图片扩展名（跳过内容读取，仅文件名匹配）
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.svgz',
  '.zip', '.jar', '.7z', '.gz', '.tar', '.rar',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.class', '.bin', '.dat', '.ttf', '.woff', '.woff2', '.eot'
])

// 递归收集 source/ 下所有文件，不限格式
function collectFiles(dir: string, baseDir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // 跳过纯资源目录
      if (entry.name === 'img' || entry.name === 'oldimg' || entry.name === 'assets') {
        continue
      }
      results.push(...collectFiles(fullPath, baseDir))
    } else {
      results.push(path.relative(baseDir, fullPath))
    }
  }
  return results
}

// 判断是否为可读文本文件
function isReadableText(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  if (BINARY_EXTENSIONS.has(ext)) return false
  return true
}

// 自适应搜索：不限格式，文本文件按内容匹配，二进制文件仅按文件名匹配
export function searchSourceFiles(query: string): SourceFile[] {
  const baseDir = path.resolve(SOURCE_DATABASE_PATH)
  if (!fs.existsSync(baseDir)) {
    console.log(`[Source] 文件目录不存在: ${baseDir}`)
    return []
  }

  const files = collectFiles(baseDir, baseDir)
  if (files.length === 0) return []

  const keywords = query.toLowerCase().split(/\s+/).filter((k) => k.length > 1)
  const results: SourceFile[] = []

  for (const file of files) {
    const fullPath = path.join(baseDir, file)
    const lowerName = file.toLowerCase()

    // 文件名匹配任意关键词
    const nameMatch = keywords.some((kw) => lowerName.includes(kw))

    if (!isReadableText(file)) {
      // 二进制文件仅做文件名匹配
      if (nameMatch) {
        results.push({
          path: file,
          content: `[二进制文件，无法读取内容] ${fullPath}`
        })
      }
      continue
    }

    try {
      const raw = fs.readFileSync(fullPath, 'utf-8')
      // 双重检测：含 null 字节则视为二进制
      if (raw.includes('\x00')) {
        if (nameMatch) {
          results.push({
            path: file,
            content: `[二进制文件，无法读取内容] ${fullPath}`
          })
        }
        continue
      }

      const lowerContent = raw.toLowerCase()
      const contentMatch = keywords.some((kw) => lowerContent.includes(kw))

      if (!nameMatch && !contentMatch) continue

      results.push({
        path: file,
        content: raw.length > MAX_CONTENT_LENGTH
          ? raw.slice(0, MAX_CONTENT_LENGTH) +
            `\n\n... (文件过长，已截断，原长度 ${raw.length} 字符)`
          : raw
      })
    } catch (err) {
      const error = err as Error
      console.warn(`[Source] 读取失败: ${file}: ${error.message}`)
    }
  }

  if (results.length > 0) {
    console.log(
      `[Source] 搜索 "${query.slice(0, 40)}" ` +
      `-> ${results.length} 个文件: ${results.map((r) => r.path).join(', ')}`
    )
  }
  return results
}

// 列出源码目录下所有文件（供 agent 了解文件结构）
export function listSourceFiles(): string[] {
  const baseDir = path.resolve(SOURCE_DATABASE_PATH)
  if (!fs.existsSync(baseDir)) return []
  return collectFiles(baseDir, baseDir)
}
