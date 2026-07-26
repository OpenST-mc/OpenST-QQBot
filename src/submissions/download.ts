// 投稿压缩包下载与解压
// 下载 issue 中附带的投稿全量包，解压后返回内部文件列表
import axios from 'axios'
import yauzl, { Entry, ZipFile } from 'yauzl'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// 最大下载大小 50MB
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024

// 单个文件与解压后总大小均限制为 50MB，防止 zip bomb 耗尽内存
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024

// 最多解压 1000 个非目录文件，限制大量小文件消耗资源
const MAX_FILE_COUNT = 1000

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

  const zip = await yauzl.fromBufferPromise(buffer, {
    autoClose: false,
    lazyEntries: true
  })

  try {
    const entries = await readFileEntries(zip)
    const commonPrefix = findCommonPrefix(entries.map((entry) => entry.fileName))
    const result: ExtractedFiles = {}
    let uncompressedBytes = 0

    for (const entry of entries) {
      const relPath = commonPrefix
        ? entry.fileName.slice(commonPrefix.length).replace(/^[\\/]/, '')
        : entry.fileName
      const data = await readEntry(zip, entry, (chunkLength) => {
        uncompressedBytes += chunkLength
        return uncompressedBytes <= MAX_UNCOMPRESSED_BYTES
      })
      result[relPath] = data
    }

    return result
  } finally {
    closeZip(zip)
  }
}

// 使用 lazy entries 先收集路径，以保留去掉公共顶层目录的行为
function readFileEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = []
    let settled = false

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      closeZip(zip)
      reject(error)
    }

    zip.once('error', fail)
    zip.on('entry', (entry: Entry) => {
      if (!entry.fileName.endsWith('/')) {
        entries.push(entry)
        if (entries.length > MAX_FILE_COUNT) {
          fail(new Error(`投稿包文件数量超过限制 ${MAX_FILE_COUNT}`))
          return
        }
      }
      zip.readEntry()
    })
    zip.once('end', () => {
      if (settled) return
      settled = true
      resolve(entries)
    })
    zip.readEntry()
  })
}

// 逐块读取条目，在追加到结果前检查单文件及全部文件的解压大小
function readEntry(
  zip: ZipFile,
  entry: Entry,
  addToTotal: (chunkLength: number) => boolean
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (openError, stream) => {
      if (openError) {
        closeZip(zip)
        reject(openError)
        return
      }

      const chunks: Buffer[] = []
      let fileBytes = 0
      let settled = false

      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        stream.destroy()
        closeZip(zip)
        reject(error)
      }

      stream.on('data', (chunk: Buffer) => {
        const nextFileBytes = fileBytes + chunk.length
        if (nextFileBytes > MAX_UNCOMPRESSED_BYTES) {
          fail(new Error(
            `投稿包单个文件解压后大小超过限制 ${MAX_UNCOMPRESSED_BYTES / (1024 * 1024)}MB`
          ))
          return
        }
        if (!addToTotal(chunk.length)) {
          fail(new Error(
            `投稿包解压后总大小超过限制 ${MAX_UNCOMPRESSED_BYTES / (1024 * 1024)}MB`
          ))
          return
        }
        fileBytes = nextFileBytes
        chunks.push(chunk)
      })
      stream.once('error', fail)
      stream.once('end', () => {
        if (settled) return
        settled = true
        resolve(Buffer.concat(chunks, fileBytes))
      })
    })
  })
}

function closeZip(zip: ZipFile): void {
  if (zip.isOpen) zip.close()
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
    const fullPath = path.join(tmpDir, filePath)
    const dir = path.dirname(fullPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(fullPath, data)
  }

  console.log(`[Submissions] 已解压到临时目录: ${tmpDir}`)
  return tmpDir
}
