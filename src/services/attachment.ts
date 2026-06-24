/**
 * 附件解析服务
 * 下载 QQ 消息附件，图片用 Tesseract OCR，文本文件直接读取
 */
import axios from 'axios'
import { createWorker, Worker } from 'tesseract.js'
import { QqAttachment } from '../bot/adapter'

/** OCR Worker 缓存 */
let ocrWorker: Worker | null = null

async function getOcrWorker(): Promise<Worker> {
  if (ocrWorker) {
    return ocrWorker
  }
  console.log('[OCR] 正在初始化 Tesseract（首次需下载中文语言包 ~10MB）...')
  const w = await createWorker('chi_sim+eng')
  ocrWorker = w
  console.log('[OCR] Tesseract 初始化完成')
  return w
}

/**
 * OCR 识别图片中的文字
 */
async function ocrImage(imageUrl: string): Promise<string> {
  // 下载图片
  const imgResp = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 30000
  })
  console.log(
    `[OCR] 图片下载成功, ${Buffer.from(imgResp.data).length} bytes`
  )

  const worker = await getOcrWorker()
  const { data } = await worker.recognize(imgResp.data)
  const text = data.text.trim()
  console.log(`[OCR] 识别完成: ${text.length} 字符`)
  return text
}

/**
 * 下载文本文件内容
 */
async function downloadTextFile(fileUrl: string): Promise<string> {
  const resp = await axios.get(fileUrl, {
    responseType: 'text',
    timeout: 15000,
    transformResponse: [(d: unknown) => d]
  })
  return String(resp.data || '').slice(0, 5000)
}

/** 支持的文本文件扩展名 */
const TEXT_EXT = /\.(txt|md|json|csv|log|yml|yaml|xml|html|js|ts|py|java|cpp|litematic|schem)$/i

function isTextAttachment(att: QqAttachment): boolean {
  if (att.contentType.startsWith('text/')) return true
  if (att.filename && TEXT_EXT.test(att.filename)) return true
  return false
}

/**
 * 解析消息中的所有附件
 */
export async function parseAttachments(
  attachments: QqAttachment[]
): Promise<string> {
  if (attachments.length === 0) {
    return ''
  }

  const results: string[] = []

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i]
    const isImage = att.contentType.startsWith('image/')
    const isText = isTextAttachment(att)

    if (!isImage && !isText) {
      continue
    }

    try {
      console.log(
        `[Attachment] 解析 ${i + 1}: ${att.filename || att.contentType} ` +
        `(${isImage ? 'OCR' : '文本'})`
      )
      let text = ''

      if (isImage) {
        text = await ocrImage(att.url)
      } else {
        text = await downloadTextFile(att.url)
      }

      if (text) {
        const label = att.filename || (isImage ? `图片${i + 1}` : `文件${i + 1}`)
        results.push(
          `以下为用户上传的 "${label}" 的内容:\n\n${text}`
        )
      }
    } catch (err) {
      const error = err as Error & { response?: { status: number } }
      console.error(
        `[Attachment] 解析 ${i + 1} 失败: ${error.message}`,
        error.response ? `status=${error.response.status}` : ''
      )
    }
  }

  return results.join('\n\n---\n\n')
}

/**
 * 清理 OCR Worker
 */
export async function closeOcr(): Promise<void> {
  if (ocrWorker) {
    await ocrWorker.terminate()
    ocrWorker = null
  }
}
