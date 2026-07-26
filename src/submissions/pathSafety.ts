// 路径安全校验
// 防止压缩包内的 entry 路径包含 .. 或绝对路径，导致解压/写入时逃逸出目标目录（zip slip）
import * as path from 'path'

// 仅用于路径运算的虚拟锚点，不会真实创建目录
const ANCHOR = path.resolve(path.sep, '__openst_path_safety_anchor__')

// 校验 relPath 是否会逃逸出任意基准目录
// 不安全时抛出错误，调用方应整体拒绝该压缩包，而非跳过单个文件
export function assertSafeRelativePath(relPath: string): void {
  const normalized = relPath.replace(/\\/g, '/')

  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    throw new Error(`检测到不安全的压缩包路径（绝对路径）: ${relPath}`)
  }

  const resolved = path.resolve(ANCHOR, normalized)
  if (resolved !== ANCHOR && !resolved.startsWith(ANCHOR + path.sep)) {
    throw new Error(`检测到不安全的压缩包路径（目录穿越）: ${relPath}`)
  }
}

// 将 relPath 安全地拼接到 baseDir 下，校验结果仍在 baseDir 内后返回绝对路径
// 不安全时抛出错误
export function safeJoin(baseDir: string, relPath: string): string {
  assertSafeRelativePath(relPath)

  const resolvedBase = path.resolve(baseDir)
  const resolvedPath = path.resolve(resolvedBase, relPath.replace(/\\/g, '/'))

  if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(resolvedBase + path.sep)) {
    throw new Error(`检测到不安全的路径（目录穿越）: ${relPath}`)
  }

  return resolvedPath
}
