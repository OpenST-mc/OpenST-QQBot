/**
 * 上传页面的 Express 服务
 * 提供带 token 验证的上传页面及处理接口
 * /upload?token=xxx -> 上传表单页
 * POST /upload?token=xxx -> 处理上传
 */
import express, { Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import { v4 as uuidv4 } from 'uuid'
import { UPLOAD_PORT, UPLOAD_TOKEN_EXPIRY_MS, UPLOAD_DIR } from '../config'
import { uploadCategories } from './config'

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

/** 生成一个上传令牌并返回完整 URL */
export function generateUploadToken(baseUrl: string): string {
  const token = uuidv4()
  activeTokens.set(token, {
    token,
    expireAt: Date.now() + UPLOAD_TOKEN_EXPIRY_MS
  })
  return `${baseUrl}/upload?token=${token}`
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

/**
 * 生成上传页面的 HTML
 * 仅包含表单，不含样式依赖
 */
function renderUploadPage(token: string): string {
  const categoryOptions = uploadCategories
    .map((c) => `<option value="${c.key}">${c.label}</option>`)
    .join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenST 上传稿件</title>
</head>
<body>
  <h1>上传机器稿件</h1>
  <form id="uploadForm" enctype="multipart/form-data">
    <div>
      <label>名称: <input type="text" name="name" required></label>
    </div>
    <div>
      <label>作者: <input type="text" name="author" required></label>
    </div>
    <div>
      <label>分类:
        <select name="category" required>
          ${categoryOptions}
        </select>
      </label>
    </div>
    <div>
      <label>图片: <input type="file" name="image" accept="image/*" required></label>
    </div>
    <input type="hidden" name="token" value="${token}">
    <button type="submit">上传</button>
  </form>
  <div id="result"></div>
  <script>
    document.getElementById('uploadForm').addEventListener('submit', async (e) => {
      e.preventDefault()
      const formData = new FormData(e.target)
      const token = formData.get('token')
      try {
        const resp = await fetch('/upload?token=' + token, {
          method: 'POST',
          body: formData
        })
        const result = await resp.json()
        document.getElementById('result').innerHTML =
          '<pre>' + JSON.stringify(result, null, 2) + '</pre>'
      } catch (err) {
        document.getElementById('result').innerHTML =
          '<p style="color:red">上传失败</p>'
      }
    })
  </script>
</body>
</html>`
}

/** 配置 multer 内存存储 */
const storage = multer.memoryStorage()
const uploadMulter = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB 限制
})

/**
 * 启动上传 Express 服务
 * 在独立端口运行，通过 token 控制访问
 */
export function startUploadServer(): void {
  const app = express()

  // GET: 渲染上传页面
  app.get('/upload', (req: Request, res: Response) => {
    const token = String(req.query['token'] || '')
    if (!token || !validateToken(token)) {
      res.status(403).send('无效或已过期的令牌')
      return
    }
    res.send(renderUploadPage(token))
  })

  // POST: 处理文件上传
  app.post(
    '/upload',
    uploadMulter.single('image'),
    async (req: Request, res: Response) => {
      const token = String(req.query['token'] || req.body['token'] || '')
      if (!token || !validateToken(token)) {
        res.status(403).json({ error: '无效或已过期的令牌' })
        return
      }

      const name = String(req.body['name'] || '').trim()
      const author = String(req.body['author'] || '').trim()
      const category = String(req.body['category'] || '').trim()
      const imageFile = req.file

      // 校验必填字段
      if (!name || !author || !category || !imageFile) {
        res.status(400).json({ error: '缺少必填字段' })
        return
      }

      // 校验分类是否合法
      const isValidCategory = uploadCategories.some(
        (c) => c.key === category
      )
      if (!isValidCategory) {
        res.status(400).json({ error: '无效的分类' })
        return
      }

      try {
        // 生成 sub_id：sub-<1970年到现在的毫秒数>
        const subId = 'sub-' + Date.now()

        // 创建稿件目录
        const draftDir = path.join(UPLOAD_DIR, subId)
        fs.mkdirSync(draftDir, { recursive: true })

        // 图片转 webp
        const webpBuffer = await sharp(imageFile.buffer)
          .webp({ quality: 85 })
          .toBuffer()
        fs.writeFileSync(path.join(draftDir, 'preview.webp'), webpBuffer)

        // 生成 info.json
        const infoJson = {
          name,
          author,
          category,
          sub_id: subId,
          created_at: new Date().toISOString()
        }
        fs.writeFileSync(
          path.join(draftDir, 'info.json'),
          JSON.stringify(infoJson, null, 2)
        )

        // 使用后销毁令牌
        activeTokens.delete(token)

        res.json({ success: true, sub_id: subId, info: infoJson })
      } catch (err) {
        const error = err as Error
        console.error('[Upload] 处理上传失败:', error.message)
        res.status(500).json({ error: '服务器处理失败' })
      }
    }
  )

  app.listen(UPLOAD_PORT, () => {
    console.log(`[Upload] 上传服务已启动 http://localhost:${UPLOAD_PORT}`)
  })
}
