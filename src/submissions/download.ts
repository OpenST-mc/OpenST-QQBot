// 投稿压缩包下载与解压
// 下载 issue 中附带的投稿全量包，解压后返回内部文件列表
import axios from 'axios'
import JSZip from 'jszip'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { assertSafeRelativePath, safeJoin } from './pathSafety'

// 最大下载大小 50MB
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024

// 解压结果：文件路径 -> Buffer 的映射
export interface ExtractedFiles {
  [filePath: string]: Buffer
}

// 从 issue body 中提取下载链接
export function extractDownloadUrl(body: string): string {
  const patterns = [
    /\[点击下载投稿全量包\]\((https?:\/\/[^\s)]+)\)/,
    /\[.*下载.*\]\((https?:\/\/[^\s)]+)\)/,
    /https?:\/\/[^\s)]*download[^\s)]*/
  ]

  for (const pattern of patterns) {
    const match = body.match(pattern)
    if (match) return match[1] || match[0]
  }

  return ''
}

// 下载并解压投稿压缩包
// 去掉顶层文件夹，将其内部所有文件收集到扁平映射中
// 例如 zip 内有 file_abc/machine.schem，则返回 { "machine.schem": Buffer }
export async function downloadAndExtract(zipUrl: string): Promise<ExtractedFiles> {
  // 先发 HEAD 请求检查文件大小
  try {
    const headResp = await axios.head(zipUrl, { timeout: 15000 })
    const contentLength = parseInt(
      String(headResp.headers['content-length'] || '0'), 10
    )
    if (contentLength > MAX_DOWNLOAD_BYTES) {
      const sizeMB = (contentLength / (1024 * 1024)).toFixed(1)
      throw new Error(
        `投稿包过大 (${sizeMB}MB)，超过限制 ${MAX_DOWNLOAD_BYTES / (1024 * 1024)}MB`
      )
    }
  } catch (err) {
    const error = err as Error
    // HEAD 请求失败不阻止下载（某些 CDN 不支持 HEAD），但对已知错误直接抛出
    if (error.message.includes('投稿包过大')) throw error
    console.log(`[Submissions] HEAD 请求失败，跳过大小检查: ${error.message}`)
  }

  const resp = await axios.get(zipUrl, {
    responseType: 'arraybuffer',
    timeout: 120000
  })

  // 对已下载的数据做二次大小校验
  if (resp.data && (resp.data as ArrayBuffer).byteLength > MAX_DOWNLOAD_BYTES) {
    const sizeMB = ((resp.data as ArrayBuffer).byteLength / (1024 * 1024)).toFixed(1)
    throw new Error(
      `投稿包过大 (${sizeMB}MB)，超过限制 ${MAX_DOWNLOAD_BYTES / (1024 * 1024)}MB`
    )
  }

  const buffer = Buffer.from(resp.data as ArrayBuffer)

  const zip = await JSZip.loadAsync(buffer)
  const result: ExtractedFiles = {}

  // 收集所有文件路径
  const fileEntries: Array<{ zipPath: string; entry: JSZip.JSZipObject }> = []
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return
    fileEntries.push({ zipPath: relativePath, entry })
  })

  // 找到所有文件的公共前缀（顶层文件夹名）
  const commonPrefix = findCommonPrefix(fileEntries.map((f) => f.zipPath))

  for (const { zipPath, entry } of fileEntries) {
    const relPath = commonPrefix
      ? zipPath.slice(commonPrefix.length).replace(/^[\\/]/, '')
      : zipPath

    // 拒绝含目录穿越或绝对路径的 entry，整包拒绝而非跳过单个文件
    assertSafeRelativePath(relPath)

    const data = await entry.async('nodebuffer')
    result[relPath] = data
  }

  return result
}

// 找出路径列表的公共前缀目录
function findCommonPrefix(paths: string[]): string {
  if (paths.length === 0) return ''

  const parts = paths.map((p) => p.split(/[\\/]/))
  const first = parts[0]

  for (let i = 0; i < first.length; i++) {
    for (let j = 1; j < parts.length; j++) {
      if (parts[j][i] !== first[i]) {
        return first.slice(0, i).join('/')
      }
    }
  }

  return first.join('/')
}

// 将解压后的文件保存到临时目录，返回临时目录路径
// 用于直接操作文件系统的场景
export async function extractToTemp(zipUrl: string): Promise<string> {
  const files = await downloadAndExtract(zipUrl)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openst-submission-'))

  for (const [filePath, data] of Object.entries(files)) {
    const fullPath = safeJoin(tmpDir, filePath)
    const dir = path.dirname(fullPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(fullPath, data)
  }

  console.log(`[Submissions] 已解压到临时目录: ${tmpDir}`)
  return tmpDir
}
