import { test } from 'node:test'
import assert from 'node:assert/strict'
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

test('downloadAndExtract 拒绝解压后总大小超过上限的高压缩比 zip（zip bomb）', async () => {
  // 高压缩比：单个重复字符文件，压缩后体积很小，但解压后远超上限
  const hugeContent = Buffer.alloc(60 * 1024 * 1024, 'A')
  const buffer = await buildZipBuffer({
    'sub/huge.txt': hugeContent
  })
  await withMockedDownload(buffer, async () => {
    await assert.rejects(
      () => downloadAndExtract(FAKE_URL),
      /解压后大小超过限制/
    )
  })
})
