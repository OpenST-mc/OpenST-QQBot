/**
 * 上传 API 服务（纯后端，不渲染 HTML）
 * 前端页面独立部署在 Vercel，本服务仅提供 API 端点
 * POST /api/upload/submit -> JSZip 打包 -> Worker 中继 -> GitHub Issue
 */
import express, { Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import { v4 as uuidv4 } from 'uuid'
import JSZip from 'jszip'
import FormData from 'form-data'
import axios from 'axios'
import {
  UPLOAD_PORT,
  UPLOAD_TOKEN_EXPIRY_MS,
  UPLOAD_DIR,
  GITHUB_TOKEN,
  GH_SUBMISSION_REPO,
  WORKER_URL
} from '../config'

/** 令牌存储（内存中） */
interface TokenEntry {
  token: string
  expireAt: number
}
const activeTokens: Map<string, TokenEntry> = new Map()

/** 清理过期令牌 */
setInterval(() => {
  const now = Date.now()
  for (const [token, entry] of activeTokens) {
    if (now > entry.expireAt) {
      activeTokens.delete(token)
    }
  }
}, 60 * 1000)

/** 生成一个上传令牌，返回令牌字符串 */
export function generateToken(): string {
  const token = uuidv4()
  activeTokens.set(token, {
    token,
    expireAt: Date.now() + UPLOAD_TOKEN_EXPIRY_MS
  })
  return token
}

/** 验证令牌有效性 */
function validateToken(token: string): boolean {
  const entry = activeTokens.get(token)
  if (!entry) {
    return false
  }
  if (Date.now() > entry.expireAt) {
    activeTokens.delete(token)
    return false
  }
  return true
}

/** CORS 中间件：允许跨域访问 */
function corsMiddleware(req: Request, res: Response, next: () => void): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
}

/** 配置 multer 内存存储，接收预览图 + 存档文件 */
const storage = multer.memoryStorage()
const uploadMulter = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB 总限制
})

/**
 * 启动上传 API 服务
 */
export function startUploadServer(): void {
  const app = express()

  app.use(corsMiddleware)

  // 处理投稿提交
  app.post(
    '/api/upload/submit',
    uploadMulter.fields([
      { name: 'preview', maxCount: 1 },
      { name: 'litematic', maxCount: 1 }
    ]),
    async (req: Request, res: Response) => {
      const token = String(req.query['token'] || req.body['token'] || '')
      if (!token || !validateToken(token)) {
        res.status(403).json({ error: '无效或已过期的令牌' })
        return
      }

      const name = String(req.body['name'] || '').trim()
      const author = String(req.body['author'] || '').trim()
      const contact = String(req.body['contact'] || '').trim()
      const desc = String(req.body['desc'] || '').trim()
      const rawTags = req.body['tags'] || []

      const files = req.files as
        | { [fieldname: string]: Express.Multer.File[] }
        | undefined
      const previewFile = files?.['preview']?.[0]
      const litematicFile = files?.['litematic']?.[0]

      if (!name || !author) {
        res.status(400).json({ error: '缺少必填字段（名称 / 作者）' })
        return
      }
      if (!previewFile) {
        res.status(400).json({ error: '请上传预览图' })
        return
      }
      if (!litematicFile) {
        res.status(400).json({ error: '请上传存档文件' })
        return
      }

      let tags: string[] = []
      if (Array.isArray(rawTags)) {
        tags = rawTags
          .map((t: unknown) => String(t).trim())
          .filter((t: string) => t)
      } else if (typeof rawTags === 'string') {
        tags = [rawTags.trim()].filter((t: string) => t)
      }

      try {
        const safeFolderName = name.replace(/[#\\/:*?"<>|]/g, '_')

        const previewExt =
          previewFile.originalname.split('.').pop()?.toLowerCase() || 'png'
        const previewFileName = `preview.${previewExt}`
        const originalFileName = litematicFile.originalname
        const now = new Date()

        const infoJson = {
          'id': `sub-${now.getTime()}`,
          'name': name,
          'author': author || '匿名',
          'tags': tags,
          'description': desc,
          'folder': safeFolderName,
          'preview': previewFileName,
          'filename': originalFileName,
          'submitDate': now.toISOString()
        }

        // JSZip 打包
        const zip = new JSZip()
        const folder = zip.folder(safeFolderName)!
        folder.file('info.json', JSON.stringify(infoJson, null, 4))
        folder.file(previewFileName, previewFile.buffer)
        folder.file(originalFileName, litematicFile.buffer)
        const zipBuffer = await zip.generateAsync({
          type: 'nodebuffer',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 }
        })

        // 中继到 Worker
        let downloadUrl: string | undefined
        let filePath: string | undefined

        try {
          const workerFd = new FormData()
          workerFd.append('name', name)
          workerFd.append('zip', zipBuffer, {
            filename: `submission_${safeFolderName}.zip`,
            contentType: 'application/zip'
          })
          workerFd.append('preview', previewFile.buffer, {
            filename: previewFile.originalname,
            contentType: previewFile.mimetype
          })

          const workerRes = await axios.post(
            `${WORKER_URL}/api/archive-upload`,
            workerFd,
            {
              headers: workerFd.getHeaders(),
              timeout: 60000
            }
          )

          if (workerRes.data?.success) {
            downloadUrl = workerRes.data.downloadUrl
            filePath = workerRes.data.filePath
            console.log('[Upload] Worker 中继成功:', downloadUrl)
          }
        } catch (workerErr) {
          const err = workerErr as Error
          console.error('[Upload] Worker 中继失败:', err.message)
        }

        const domesticDownloadUrl =
          downloadUrl ||
          (filePath ? `${WORKER_URL}/dl/${filePath}` : undefined)

        // 创建 GitHub Issue
        let githubIssueUrl: string | undefined

        if (!GITHUB_TOKEN) {
          console.warn('[Upload] 未配置 GITHUB_TOKEN，跳过 Issue 创建')
        } else {
          try {
            const dlSection = domesticDownloadUrl
              ? '> [!IMPORTANT]\n' +
                '> **存档审核直连下载 (国内加速)**: ' +
                `[点击下载投稿全量包](${domesticDownloadUrl})\n`
              : ''

            const issueBody =
              `## Machine Submission: ${name}\n\n` +
              dlSection +
              `\n### Info (info.json)\n` +
              '```json\n' +
              JSON.stringify(infoJson, null, 4) +
              '\n```\n' +
              '\n---\n' +
              `**Submission Details**\n` +
              `- **Author**: ${author}\n` +
              `- **Contact**: ${contact || 'Not provided'}\n` +
              `- **Description**: \n${desc}\n\n` +
              '_Submitted via OpenST QQ Bot_'

            const ghRes = await axios.post(
              `https://api.github.com/repos/${GH_SUBMISSION_REPO}/issues`,
              {
                title: `[OpenST] ${name} @${author}`,
                labels: ['bot-submission'],
                body: issueBody
              },
              {
                headers: {
                  'Authorization': `Bearer ${GITHUB_TOKEN}`,
                  'Accept': 'application/vnd.github.v3+json',
                  'Content-Type': 'application/json'
                },
                timeout: 15000
              }
            )

            githubIssueUrl = ghRes.data?.html_url
            console.log('[Upload] GitHub Issue 创建成功:', githubIssueUrl)
          } catch (ghErr) {
            const err = ghErr as Error & {
              response?: { status: number; data: unknown }
            }
            console.error(
              '[Upload] GitHub Issue 创建失败:',
              err.message,
              err.response ? JSON.stringify(err.response.data) : ''
            )
          }
        }

        // 保存本地备份
        try {
          const draftDir = path.join(UPLOAD_DIR, `sub-${now.getTime()}`)
          fs.mkdirSync(draftDir, { recursive: true })

          const webpBuffer = await sharp(previewFile.buffer)
            .webp({ quality: 85 })
            .toBuffer()
          fs.writeFileSync(path.join(draftDir, 'preview.webp'), webpBuffer)
          fs.writeFileSync(
            path.join(draftDir, 'info.json'),
            JSON.stringify(infoJson, null, 2)
          )
          fs.writeFileSync(path.join(draftDir, 'submission.zip'), zipBuffer)
        } catch (backupErr) {
          const err = backupErr as Error
          console.error('[Upload] 本地备份失败:', err.message)
        }

        // 使用后销毁令牌
        activeTokens.delete(token)

        res.json({
          success: true,
          subId: infoJson.id,
          issueUrl: githubIssueUrl,
          downloadUrl: domesticDownloadUrl
        })
      } catch (err) {
        const error = err as Error
        console.error('[Upload] 处理投稿失败:', error.message)
        res.status(500).json({ error: '服务器处理失败' })
      }
    }
  )

  app.listen(UPLOAD_PORT, () => {
    console.log(`[Upload] API 服务已启动 http://localhost:${UPLOAD_PORT}`)
  })
}
