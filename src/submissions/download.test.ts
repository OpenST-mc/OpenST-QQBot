import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createDeflateRaw } from 'node:zlib'
import JSZip from 'jszip'
import axios from 'axios'
import { downloadAndExtract } from './download'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const axiosAny = axios as any

async function buildZipBuffer(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content)
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  })
}

interface CompressedEntry {
  name: string
  size: number
}

// 按小块生成高压缩比内容，避免测试先配置超过限制的原始 Buffer
async function buildCompressedZip(entries: CompressedEntry[]): Promise<Buffer> {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const entry of entries) {
    const { compressed, crc32 } = await compressRepeatedContent(entry.size)
    const name = Buffer.from(entry.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc32, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.size, 22)
    local.writeUInt16LE(name.length, 26)
    localParts.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc32, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(localOffset, 42)
    centralParts.push(central, name)
    localOffset += local.length + name.length + compressed.length
  }

  const centralSize = centralParts.reduce((size, part) => size + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(localOffset, 16)
  return Buffer.concat([...localParts, ...centralParts, end])
}

async function compressRepeatedContent(size: number): Promise<{ compressed: Buffer; crc32: number }> {
  const deflate = createDeflateRaw({ level: 9 })
  const compressed: Buffer[] = []
  let crc32 = 0xffffffff
  deflate.on('data', (chunk: Buffer) => compressed.push(chunk))
  const complete = once(deflate, 'end')

  for (let remaining = size; remaining > 0; remaining -= 64 * 1024) {
    const chunk = Buffer.alloc(Math.min(remaining, 64 * 1024), 'A')
    crc32 = updateCrc32(crc32, chunk)
    if (!deflate.write(chunk)) await once(deflate, 'drain')
  }
  deflate.end()
  await complete
  return { compressed: Buffer.concat(compressed), crc32: (crc32 ^ 0xffffffff) >>> 0 }
}

function updateCrc32(crc32: number, data: Buffer): number {
  let value = crc32
  for (const byte of data) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    }
  }
  return value >>> 0
}

// 用假的 axios.get/head 替换真实网络请求，模拟下载到内存中构造的 zip
async function withMockedDownload(buffer: Buffer, run: () => Promise<void>): Promise<void> {
  const originalGet = axiosAny.get
  const originalHead = axiosAny.head
  axiosAny.get = async () => ({ data: buffer, headers: {} })
  axiosAny.head = async () => ({ headers: {} })
  try {
    await run()
  } finally {
    axiosAny.get = originalGet
    axiosAny.head = originalHead
  }
}

// 使用默认可信中继域名（与 WORKER_URL 默认值一致），避免与另一分支
// （fix/submission-download-ssrf）新增的下载域名白名单检查冲突——
// 该分支合并后 downloadAndExtract 会先校验 host，example.invalid 会被拒绝
const FAKE_URL = 'http://api.openstmc.com/submission.zip'

test('downloadAndExtract 正常大小投稿包不受影响', async () => {
  const buffer = await buildZipBuffer({
    'sub/a.txt': 'A',
    'sub/b/c.txt': 'C'
  })
  await withMockedDownload(buffer, async () => {
    const files = await downloadAndExtract(FAKE_URL)
    assert.deepEqual(Object.keys(files).sort(), ['a.txt', 'b/c.txt'])
    assert.equal(files['a.txt'].toString(), 'A')
    assert.equal(files['b/c.txt'].toString(), 'C')
  })
})

test('downloadAndExtract 拒绝单个文件超过解压大小上限', async () => {
  const buffer = await buildCompressedZip([
    { name: 'sub/huge.txt', size: 51 * 1024 * 1024 }
  ])
  await withMockedDownload(buffer, async () => {
    await assert.rejects(
      () => downloadAndExtract(FAKE_URL),
      /单个文件解压后大小超过限制/
    )
  })
})

test('downloadAndExtract 拒绝全部文件解压大小超过上限', async () => {
  const buffer = await buildCompressedZip([
    { name: 'sub/first.txt', size: 26 * 1024 * 1024 },
    { name: 'sub/second.txt', size: 26 * 1024 * 1024 }
  ])
  await withMockedDownload(buffer, async () => {
    await assert.rejects(
      () => downloadAndExtract(FAKE_URL),
      /解压后总大小超过限制/
    )
  })
})

test('downloadAndExtract 拒绝文件数量超过上限', async () => {
  const buffer = await buildZipBuffer(
    Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [`sub/${index}.txt`, 'A']))
  )
  await withMockedDownload(buffer, async () => {
    await assert.rejects(
      () => downloadAndExtract(FAKE_URL),
      /文件数量超过限制/
    )
  })
})
