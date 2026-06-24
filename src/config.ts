/**
 * 应用配置模块
 * 所有配置从环境变量读取，不硬编码敏感信息
 */

/** QQ Bot 凭证 */
export const QQ_APP_ID = process.env['QQ_APP_ID'] || ''
export const QQ_APP_SECRET = process.env['QQ_APP_SECRET'] || ''

/**
 * 群组白名单（逗号分隔的 QQ 群号或 group_openid）
 * 仅白名单内的群可使用 bot 命令，空白则不限制
 * 私聊不受白名单影响
 * 在目标群发 /ping 可获取 group_openid 和 group_id
 */
export const QQ_GROUP_WHITELIST = parseGroupWhitelist()

function parseGroupWhitelist(): Set<string> {
  const raw = process.env['QQ_GROUP_WHITELIST'] || ''
  if (!raw.trim()) {
    return new Set()
  }
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  )
}

/** DeepSeek API 配置 */
export const DEEPSEEK_API_KEY = process.env['DEEPSEEK_API_KEY'] || ''
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
export const DEEPSEEK_MODEL = 'deepseek-chat'

/** 上传服务配置 */
export const UPLOAD_PORT = parseInt(process.env['UPLOAD_PORT'] || '3000', 10)
export const UPLOAD_TOKEN_EXPIRY_MS = 30 * 60 * 1000 // 令牌有效期 30 分钟

/** 本地机器数据库路径 */
export const DATABASE_PATH = 'public/database/database.json'
export const SHARE_BASE_URL = 'https://openstmc.com/api/share?'

/** 文件路径 */
export const GLOSSARY_CSV_PATH = 'public/database/TechMC Glossary.csv'
export const AI_AGENT_PROMPT_PATH = 'agent/AGENTS.md'

/** QQ API 端点 */
export const QQ_API_BASE = 'https://api.sgroup.qq.com'
export const QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'

/** 上传文件存储 */
export const UPLOAD_DIR = 'uploads'
