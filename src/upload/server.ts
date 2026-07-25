/**
 * 上传令牌模块
 * bot 仅负责生成 URL 参数，不运行 Express
 * 生成 28 字符 HMAC 令牌 + AES 加密 GitHub token
 */
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { UPLOAD_TOKEN_EXPIRY_MS } from '../config'

const UPLOAD_SECRET = process.env['UPLOAD_SECRET'] || ''
const GITHUB_TOKEN = process.env['GITHUB_TOKEN'] || ''

/** 从 UPLOAD_SECRET 派生 AES-256 密钥 */
function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(UPLOAD_SECRET).digest()
}

/** 生成 28 字符 HMAC 访问令牌: timestamp(11hex) + nonce(9hex) + hmac(8hex) */
export function generateToken(): string {
  const timestamp = Date.now().toString(16).padStart(11, '0').slice(0, 11)
  const nonce = uuidv4().replace(/-/g, '').slice(0, 9).padEnd(9, '0')
  const payload = timestamp + nonce

  if (!UPLOAD_SECRET) {
    return payload + '00000000'
  }

  const hmac = crypto
    .createHmac('sha256', UPLOAD_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 8)
  return payload + hmac
}

/**
 * AES-256-GCM 加密 GitHub token
 * 输出 base64url: iv(12B) + authTag(16B) + ciphertext
 */
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
