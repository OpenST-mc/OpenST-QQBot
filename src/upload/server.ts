// 上传令牌模块
// bot 仅负责生成 URL 参数，不运行 Express
// 令牌格式: timestamp + nonce + hmac，各段长度见下方 TOKEN_*_HEX_LEN 常量
//
// 这三个常量必须与 upload-frontend/api/validate.js、upload-frontend/api/submit.js
// 中的同名常量保持一致——三处分属不同部署环境（bot 进程 / Vercel Serverless
// Function），无法共享同一份源码，修改任一处的长度时必须同步修改另外两处，
// 否则会因为长度对不上导致所有令牌验证失败
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'

const UPLOAD_SECRET = process.env['UPLOAD_SECRET'] || ''
const GITHUB_TOKEN = process.env['GITHUB_TOKEN'] || ''

// 令牌各段长度（十六进制字符数）
const TOKEN_TIMESTAMP_HEX_LEN = 11
const TOKEN_NONCE_HEX_LEN = 9
// HMAC 截断长度：16 hex = 64 bit，此前是 8 hex（32 bit），32 bit 的搜索空间
// （约 43 亿种组合）在没有速率限制的情况下存在被暴力枚举伪造的风险，
// 64 bit 可将其提升到实务上不可行的量级
const TOKEN_HMAC_HEX_LEN = 16

// 从 UPLOAD_SECRET 派生 AES-256 密钥
function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(UPLOAD_SECRET).digest()
}

// 生成访问令牌: timestamp + nonce + hmac
export function generateToken(): string {
  const timestamp = Date.now().toString(16)
    .padStart(TOKEN_TIMESTAMP_HEX_LEN, '0')
    .slice(0, TOKEN_TIMESTAMP_HEX_LEN)
  const nonce = uuidv4().replace(/-/g, '')
    .slice(0, TOKEN_NONCE_HEX_LEN)
    .padEnd(TOKEN_NONCE_HEX_LEN, '0')
  const payload = timestamp + nonce

  if (!UPLOAD_SECRET) {
    throw new Error('UPLOAD_SECRET 未設定，無法生成安全的上傳令牌')
  }

  const hmac = crypto
    .createHmac('sha256', UPLOAD_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, TOKEN_HMAC_HEX_LEN)
  return payload + hmac
}

// AES-256-GCM 加密 GitHub token
// 输出 base64url: iv(12B) + authTag(16B) + ciphertext
export function encryptGhToken(): string {
  if (!GITHUB_TOKEN || !UPLOAD_SECRET) return ''

  const key = deriveKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(GITHUB_TOKEN, 'utf8'),
    cipher.final()
  ])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, authTag, encrypted]).toString('base64url')
}
